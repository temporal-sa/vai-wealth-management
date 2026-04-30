import * as readline from 'readline/promises';
import {
  generateText,
  tool,
  hasToolCall,
  ModelMessage,
  AssistantModelMessage,
  ToolModelMessage,
  ToolSet,
} from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

import {
  BENE_AGENT_NAME,
  BENE_HANDOFF,
  BENE_INSTRUCTIONS,
  INVEST_AGENT_NAME,
  INVEST_HANDOFF,
  INVEST_INSTRUCTIONS,
  SUPERVISOR_AGENT_NAME,
  SUPERVISOR_HANDOFF,
  SUPERVISOR_INSTRUCTIONS,
} from '../common/agent-constants';
import { ClientContext } from '../common/account-context';
import { BeneficiariesManager } from '../common/beneficiaries-manager';
import { InvestmentManager } from '../common/investment-manager';

// ---------------------------------------------------------------------------
// Managers
// ---------------------------------------------------------------------------

const beneficiariesMgr = new BeneficiariesManager();
const investmentMgr = new InvestmentManager();

// ---------------------------------------------------------------------------
// Shared client context — equivalent to Python's ClientContext.
// Set by supervisor handoff tools; injected into sub-agent system prompts.
// ---------------------------------------------------------------------------

const clientContext: ClientContext = {};

// ---------------------------------------------------------------------------
// Agent names
// ---------------------------------------------------------------------------

type AgentName = 'supervisor' | 'beneficiary' | 'investment';

// ---------------------------------------------------------------------------
// Domain tools
// ---------------------------------------------------------------------------

const listBeneficiaries = tool({
  description: 'List the beneficiaries for the given client id.',
  inputSchema: z.object({
    client_id: z.string().describe("The customer's client id"),
  }),
  execute: async ({ client_id }) => {
    clientContext.clientId = client_id;
    return beneficiariesMgr.listBeneficiaries(client_id);
  },
});

const addBeneficiary = tool({
  description: 'Add a new beneficiary for a client.',
  inputSchema: z.object({
    client_id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    relationship: z.string(),
  }),
  execute: async ({ client_id, first_name, last_name, relationship }) => {
    clientContext.clientId = client_id;
    return beneficiariesMgr.addBeneficiary(client_id, first_name, last_name, relationship);
  },
});

const deleteBeneficiary = tool({
  description: 'Delete a beneficiary from a client account.',
  inputSchema: z.object({
    client_id: z.string(),
    beneficiary_id: z.string(),
  }),
  execute: async ({ client_id, beneficiary_id }) => {
    clientContext.clientId = client_id;
    return beneficiariesMgr.deleteBeneficiary(client_id, beneficiary_id);
  },
});

const listInvestments = tool({
  description: "List the investment accounts and balances for the given client id.",
  inputSchema: z.object({
    client_id: z.string().describe("The customer's client id"),
  }),
  execute: async ({ client_id }) => {
    clientContext.clientId = client_id;
    return investmentMgr.listInvestmentAccounts(client_id);
  },
});

const openInvestment = tool({
  description: 'Open a new investment account for a client.',
  inputSchema: z.object({
    client_id: z.string(),
    name: z.string().describe('Name of the investment account (e.g. Roth IRA)'),
    balance: z.number().describe('Initial balance'),
  }),
  execute: async ({ client_id, name, balance }) => {
    clientContext.clientId = client_id;
    return investmentMgr.addInvestmentAccount(client_id, name, balance);
  },
});

const closeInvestment = tool({
  description: 'Close (delete) an investment account for a client.',
  inputSchema: z.object({
    client_id: z.string(),
    investment_id: z.string(),
  }),
  execute: async ({ client_id, investment_id }) => {
    clientContext.clientId = client_id;
    return investmentMgr.deleteInvestmentAccount(client_id, investment_id);
  },
});

// ---------------------------------------------------------------------------
// Handoff tools
//
// Supervisor → sub-agent handoffs require client_id so the supervisor always
// collects it before routing. The ID is stored in clientContext and injected
// into sub-agent system prompts automatically.
//
// Sub-agent → supervisor handoffs need no client_id (supervisor already has it).
// ---------------------------------------------------------------------------

const handoffToSupervisor = tool({
  description: `Transfer the customer back to the supervisor. ${SUPERVISOR_HANDOFF}`,
  inputSchema: z.object({}),
  execute: async () => `Transferring to ${SUPERVISOR_AGENT_NAME}...`,
});

const handoffToBeneficiaryAgent = tool({
  description: `Transfer the customer to the beneficiary agent. ${BENE_HANDOFF}`,
  inputSchema: z.object({
    client_id: z.string().describe("The customer's client ID, which must be collected before handoff"),
  }),
  execute: async ({ client_id }) => {
    clientContext.clientId = client_id;
    return `Transferring to ${BENE_AGENT_NAME}...`;
  },
});

const handoffToInvestmentAgent = tool({
  description: `Transfer the customer to the investment agent. ${INVEST_HANDOFF}`,
  inputSchema: z.object({
    client_id: z.string().describe("The customer's client ID, which must be collected before handoff"),
  }),
  execute: async ({ client_id }) => {
    clientContext.clientId = client_id;
    return `Transferring to ${INVEST_AGENT_NAME}...`;
  },
});

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

interface AgentDef {
  name: string;
  instructions: string;
  tools: ToolSet;
}

const agentDefs: Record<AgentName, AgentDef> = {
  supervisor: {
    name: SUPERVISOR_AGENT_NAME,
    instructions: SUPERVISOR_INSTRUCTIONS,
    tools: {
      handoff_to_beneficiary_agent: handoffToBeneficiaryAgent,
      handoff_to_investment_agent: handoffToInvestmentAgent,
    },
  },
  beneficiary: {
    name: BENE_AGENT_NAME,
    instructions: BENE_INSTRUCTIONS,
    tools: {
      list_beneficiaries: listBeneficiaries,
      add_beneficiary: addBeneficiary,
      delete_beneficiary: deleteBeneficiary,
      handoff_to_supervisor: handoffToSupervisor,
    },
  },
  investment: {
    name: INVEST_AGENT_NAME,
    instructions: INVEST_INSTRUCTIONS,
    tools: {
      list_investments: listInvestments,
      open_investment: openInvestment,
      close_investment: closeInvestment,
      handoff_to_supervisor: handoffToSupervisor,
    },
  },
};

// Map handoff tool names → target agent
const HANDOFF_TOOL_TO_AGENT: Record<string, AgentName> = {
  handoff_to_supervisor: 'supervisor',
  handoff_to_beneficiary_agent: 'beneficiary',
  handoff_to_investment_agent: 'investment',
};

// stopWhen conditions
const handoffStopConditions = [
  hasToolCall('handoff_to_supervisor'),
  hasToolCall('handoff_to_beneficiary_agent'),
  hasToolCall('handoff_to_investment_agent'),
];

// ---------------------------------------------------------------------------
// Build effective system prompt — injects known client ID into sub-agents
// so they never need to ask for it again.
// ---------------------------------------------------------------------------

function buildSystemPrompt(agentName: AgentName): string {
  const base = agentDefs[agentName].instructions;
  if (agentName === 'supervisor' || !clientContext.clientId) return base;
  return `${base}\n\nThe customer's client ID is: ${clientContext.clientId}. Do not ask for it again.`;
}

// ---------------------------------------------------------------------------
// Agent runner — mirrors Python's Runner.run() behaviour
// ---------------------------------------------------------------------------

async function runAgent(
  agentName: AgentName,
  messages: ModelMessage[],
): Promise<{ text: string; messages: ModelMessage[]; currentAgent: AgentName }> {
  let currentAgent = agentName;
  let currentMessages = messages;

  while (true) {
    const def = agentDefs[currentAgent];

    const result = await generateText({
      model: google('gemini-2.5-pro'),
      system: buildSystemPrompt(currentAgent),
      messages: currentMessages,
      tools: def.tools as any,
      stopWhen: handoffStopConditions,
    });

    // Extend history with the new response messages (assistant + any tool results)
    const newMessages = result.response.messages as Array<AssistantModelMessage | ToolModelMessage>;
    currentMessages = [...currentMessages, ...newMessages];

    // Detect handoff
    const handoffCall = result.toolCalls.find(
      (tc) => tc.toolName in HANDOFF_TOOL_TO_AGENT,
    );

    if (handoffCall) {
      const sourceName = def.name;
      const targetAgent = HANDOFF_TOOL_TO_AGENT[handoffCall.toolName];
      const targetName = agentDefs[targetAgent].name;
      console.log(`Handed off from ${sourceName} to ${targetName}`);
      currentAgent = targetAgent;
      continue;
    }

    return { text: result.text, messages: currentMessages, currentAgent };
  }
}

// ---------------------------------------------------------------------------
// Main conversation loop
// ---------------------------------------------------------------------------

async function main() {
  let currentAgent: AgentName = 'supervisor';
  let messages: ModelMessage[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Welcome to ABC Wealth Management. How can I help you?');

  while (true) {
    const userInput = await rl.question('Enter your message: ');
    const lower = userInput.trim().toLowerCase();
    if (lower === 'exit' || lower === 'end' || lower === 'quit') {
      break;
    }

    messages.push({ role: 'user', content: userInput });

    const result = await runAgent(currentAgent, messages);

    console.log(`\n${agentDefs[result.currentAgent].name}: ${result.text}\n`);

    messages = result.messages;
    currentAgent = result.currentAgent;
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
