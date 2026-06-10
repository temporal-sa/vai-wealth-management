// @temporalio/ai-sdk must load first — its side-effect import installs
// `TransformStream`, `Headers`, and `structuredClone` polyfills that
// `ai`'s transitive `eventsource-parser` references at evaluation time.
import { temporalProvider } from '@temporalio/ai-sdk';
import {
  proxyActivities,
  getExternalWorkflowHandle,
  startChild,
  uuid4,
  log,
} from '@temporalio/workflow';
import { generateText, tool, hasToolCall, ModelMessage, AssistantModelMessage, ToolModelMessage, ToolSet } from 'ai';
import { z } from 'zod';

import {
  BENE_AGENT_NAME, BENE_HANDOFF, BENE_INSTRUCTIONS,
  INVEST_AGENT_NAME, INVEST_HANDOFF, INVEST_INSTRUCTIONS,
  SUPERVISOR_AGENT_NAME, SUPERVISOR_HANDOFF, SUPERVISOR_INSTRUCTIONS,
  OPEN_ACCOUNT_AGENT_NAME, OPEN_ACCOUNT_HANDOFF, OPEN_ACCOUNT_INSTRUCTIONS,
} from '../../common/agent-constants';
import { ClientContext } from '../../common/account-context';
import { ChatInteraction, OpenInvestmentAccountInput, TASK_QUEUE_NAME } from '../shared';
import type * as beneficiaryActivities from '../activities/beneficiaries';
import type * as investmentActivities from '../activities/investments';
import type * as openAccountActivities from '../activities/open-account';

// ---------------------------------------------------------------------------
// Proxied activities (filesystem / cross-workflow query+update I/O)
// ---------------------------------------------------------------------------

const beneficiariesActs = proxyActivities<typeof beneficiaryActivities>({
  startToCloseTimeout: '30s',
});
const investmentActs = proxyActivities<typeof investmentActivities>({
  startToCloseTimeout: '30s',
});
const openAccountActs = proxyActivities<typeof openAccountActivities>({
  startToCloseTimeout: '30s',
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentName = 'supervisor' | 'beneficiary' | 'investment' | 'open_account';

interface AgentDef {
  name: string;
  instructions: (ctx: AgentRunContext) => string;
  tools: ToolSet;
}

interface AgentRunContext {
  clientContext: ClientContext;
  childWorkflowId?: string;
  parentWorkflowId: string;
  traceLines: string[];
}

// ---------------------------------------------------------------------------
// Tool builders — tool execute runs in workflow context; non-deterministic
// work must go through activities or workflow primitives.
// ---------------------------------------------------------------------------

function buildBeneficiaryTools(ctx: AgentRunContext): ToolSet {
  return {
    list_beneficiaries: tool({
      description: 'List the beneficiaries for the given client id.',
      inputSchema: z.object({ client_id: z.string() }),
      execute: async ({ client_id }) => {
        ctx.clientContext.clientId = client_id;
        ctx.traceLines.push(`list_beneficiaries(${client_id})`);
        return beneficiariesActs.listBeneficiaries(client_id);
      },
    }),
    add_beneficiary: tool({
      description: 'Add a new beneficiary for a client.',
      inputSchema: z.object({
        client_id: z.string(), first_name: z.string(),
        last_name: z.string(), relationship: z.string(),
      }),
      execute: async ({ client_id, first_name, last_name, relationship }) => {
        ctx.clientContext.clientId = client_id;
        ctx.traceLines.push(`add_beneficiary(${client_id}, ${first_name} ${last_name})`);
        return beneficiariesActs.addBeneficiary(client_id, first_name, last_name, relationship);
      },
    }),
    delete_beneficiary: tool({
      description: 'Delete a beneficiary from a client account.',
      inputSchema: z.object({ client_id: z.string(), beneficiary_id: z.string() }),
      execute: async ({ client_id, beneficiary_id }) => {
        ctx.clientContext.clientId = client_id;
        ctx.traceLines.push(`delete_beneficiary(${client_id}, ${beneficiary_id})`);
        return beneficiariesActs.deleteBeneficiary(client_id, beneficiary_id);
      },
    }),
  };
}

function buildInvestmentTools(ctx: AgentRunContext): ToolSet {
  return {
    list_investments: tool({
      description: "List the investment accounts and balances for the given client id.",
      inputSchema: z.object({ client_id: z.string() }),
      execute: async ({ client_id }) => {
        ctx.clientContext.clientId = client_id;
        ctx.traceLines.push(`list_investments(${client_id})`);
        return investmentActs.listInvestments(client_id);
      },
    }),
    close_investment: tool({
      description: 'Close (delete) an investment account for a client.',
      inputSchema: z.object({ client_id: z.string(), investment_id: z.string() }),
      execute: async ({ client_id, investment_id }) => {
        ctx.clientContext.clientId = client_id;
        ctx.traceLines.push(`close_investment(${client_id}, ${investment_id})`);
        return investmentActs.closeInvestment(client_id, investment_id);
      },
    }),
  };
}

function buildOpenAccountTools(ctx: AgentRunContext): ToolSet {
  return {
    open_new_investment_account: tool({
      description: 'Begin opening a new investment account. Returns the child workflow ID to track progress.',
      inputSchema: z.object({
        client_id: z.string(),
        account_name: z.string().describe('Name of the new investment account'),
        initial_amount: z.number().describe('Initial deposit amount'),
      }),
      execute: async ({ client_id, account_name, initial_amount }) => {
        ctx.clientContext.clientId = client_id;
        const childId = `open-account-${uuid4()}`;
        ctx.childWorkflowId = childId;
        ctx.traceLines.push(`open_new_investment_account(${client_id}, ${account_name}, ${initial_amount}) → ${childId}`);
        const workflowInput: OpenInvestmentAccountInput = {
          client_id,
          account_name,
          initial_amount,
          parent_workflow_id: ctx.parentWorkflowId,
        };
        await startChild('OpenInvestmentAccountWorkflow', {
          workflowId: childId,
          taskQueue: TASK_QUEUE_NAME,
          args: [workflowInput],
        });
        return { child_workflow_id: childId, message: 'Account opening process started.' };
      },
    }),
    get_current_client_info: tool({
      description: 'Retrieve the current client information from the account opening workflow.',
      inputSchema: z.object({ child_workflow_id: z.string() }),
      execute: async ({ child_workflow_id }) => {
        ctx.traceLines.push(`get_current_client_info(${child_workflow_id})`);
        return openAccountActs.getCurrentClientInfo(child_workflow_id);
      },
    }),
    update_client_details: tool({
      description: 'Update the client details in the account opening workflow.',
      inputSchema: z.object({
        child_workflow_id: z.string(),
        fields: z.record(z.string(), z.string()).describe('Fields to update on the client record'),
      }),
      execute: async ({ child_workflow_id, fields }) => {
        ctx.traceLines.push(`update_client_details(${child_workflow_id})`);
        await openAccountActs.updateClientDetails(child_workflow_id, fields);
        return { message: 'Client details updated.' };
      },
    }),
    approve_kyc: tool({
      description: 'Signal that KYC verification is approved for the account opening workflow.',
      inputSchema: z.object({ child_workflow_id: z.string() }),
      execute: async ({ child_workflow_id }) => {
        ctx.traceLines.push(`approve_kyc(${child_workflow_id})`);
        await getExternalWorkflowHandle(child_workflow_id).signal('verify_kyc');
        return { message: 'KYC approved. Waiting for compliance review.' };
      },
    }),
    get_account_status: tool({
      description: 'Check the current status of the account opening workflow.',
      inputSchema: z.object({ child_workflow_id: z.string() }),
      execute: async ({ child_workflow_id }) => {
        ctx.traceLines.push(`get_account_status(${child_workflow_id})`);
        return openAccountActs.getAccountStatus(child_workflow_id);
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Handoff tools
// ---------------------------------------------------------------------------

function buildHandoffTools(handoffs: AgentName[]): ToolSet {
  const defs: ToolSet = {};

  const configs: Record<AgentName, { name: string; description: string; requiresClientId: boolean }> = {
    supervisor: { name: SUPERVISOR_AGENT_NAME, description: SUPERVISOR_HANDOFF, requiresClientId: false },
    beneficiary: { name: BENE_AGENT_NAME, description: BENE_HANDOFF, requiresClientId: true },
    investment: { name: INVEST_AGENT_NAME, description: INVEST_HANDOFF, requiresClientId: true },
    open_account: { name: OPEN_ACCOUNT_AGENT_NAME, description: OPEN_ACCOUNT_HANDOFF, requiresClientId: false },
  };

  for (const target of handoffs) {
    const cfg = configs[target];
    const toolName = `handoff_to_${target}_agent`;

    if (cfg.requiresClientId) {
      defs[toolName] = tool({
        description: `Transfer the customer to the ${cfg.name}. ${cfg.description}`,
        inputSchema: z.object({
          client_id: z.string().describe("The customer's client ID, which must be collected before handoff"),
        }),
        execute: async ({ client_id: _c }) => {
          return `Transferring to ${cfg.name}...`;
        },
      });
    } else {
      defs[toolName] = tool({
        description: `Transfer the customer to the ${cfg.name}. ${cfg.description}`,
        inputSchema: z.object({}),
        execute: async () => `Transferring to ${cfg.name}...`,
      });
    }
  }

  return defs;
}

// ---------------------------------------------------------------------------
// Agent definitions factory
// ---------------------------------------------------------------------------

function buildAgentDefs(ctx: AgentRunContext): Record<AgentName, AgentDef> {
  return {
    supervisor: {
      name: SUPERVISOR_AGENT_NAME,
      instructions: () => SUPERVISOR_INSTRUCTIONS,
      tools: buildHandoffTools(['beneficiary', 'investment']),
    },
    beneficiary: {
      name: BENE_AGENT_NAME,
      instructions: (c) => c.clientContext.clientId
        ? `${BENE_INSTRUCTIONS}\n\nThe customer's client ID is: ${c.clientContext.clientId}. Do not ask for it again.`
        : BENE_INSTRUCTIONS,
      tools: {
        ...buildBeneficiaryTools(ctx),
        ...buildHandoffTools(['supervisor']),
      },
    },
    investment: {
      name: INVEST_AGENT_NAME,
      instructions: (c) => c.clientContext.clientId
        ? `${INVEST_INSTRUCTIONS}\n\nThe customer's client ID is: ${c.clientContext.clientId}. Do not ask for it again.`
        : INVEST_INSTRUCTIONS,
      tools: {
        ...buildInvestmentTools(ctx),
        ...buildHandoffTools(['supervisor', 'open_account']),
      },
    },
    open_account: {
      name: OPEN_ACCOUNT_AGENT_NAME,
      instructions: (c) => c.clientContext.clientId
        ? `${OPEN_ACCOUNT_INSTRUCTIONS}\n\nThe customer's client ID is: ${c.clientContext.clientId}. Do not ask for it again.`
        : OPEN_ACCOUNT_INSTRUCTIONS,
      tools: {
        ...buildOpenAccountTools(ctx),
        ...buildHandoffTools(['investment']),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Handoff tool name → agent name mapping
// ---------------------------------------------------------------------------

const HANDOFF_TOOL_TO_AGENT: Record<string, AgentName> = {
  handoff_to_supervisor_agent: 'supervisor',
  handoff_to_beneficiary_agent: 'beneficiary',
  handoff_to_investment_agent: 'investment',
  handoff_to_open_account_agent: 'open_account',
};

const HANDOFF_STOP_CONDITIONS = Object.keys(HANDOFF_TOOL_TO_AGENT).map(hasToolCall);

// ---------------------------------------------------------------------------
// Agent loop — runs in workflow context. The AiSdkPlugin transparently wraps
// each generateText call as a Temporal activity, giving per-LLM-call
// visibility in workflow event history.
// ---------------------------------------------------------------------------

async function runAgentLoop(
  startAgent: AgentName,
  messages: ModelMessage[],
  ctx: AgentRunContext,
): Promise<{ text: string; messages: ModelMessage[]; activeAgent: AgentName }> {
  let currentAgent = startAgent;
  let currentMessages = messages;
  const agentDefs = buildAgentDefs(ctx);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const def = agentDefs[currentAgent];
    log.info(`[${def.name}] generating response`);

    const result = await generateText({
      model: temporalProvider.languageModel('gemini-2.5-pro'),
      system: def.instructions(ctx),
      messages: currentMessages,
      tools: def.tools as any,
      stopWhen: HANDOFF_STOP_CONDITIONS,
    });

    const newMessages = result.response.messages as Array<AssistantModelMessage | ToolModelMessage>;
    currentMessages = [...currentMessages, ...newMessages];

    const traceLine = `[${def.name}]: ${result.text || '(tool calls)'}`;
    ctx.traceLines.push(traceLine);
    log.info(traceLine);

    for (const tc of result.toolCalls) {
      if (tc.toolName in HANDOFF_TOOL_TO_AGENT) {
        const input = tc.input as any;
        if (input?.client_id) ctx.clientContext.clientId = input.client_id;
      }
    }

    const handoffCall = result.toolCalls.find((tc) => tc.toolName in HANDOFF_TOOL_TO_AGENT);
    if (handoffCall) {
      const target = HANDOFF_TOOL_TO_AGENT[handoffCall.toolName];
      const handoffLine = `Handed off from ${def.name} to ${agentDefs[target].name}`;
      ctx.traceLines.push(handoffLine);
      log.info(handoffLine);
      currentAgent = target;
      continue;
    }

    log.info(`[${def.name}] final response`, { text: result.text });
    return { text: result.text, messages: currentMessages, activeAgent: currentAgent };
  }
}

// ---------------------------------------------------------------------------
// Public entry — called by WealthManagementWorkflow per user message
// ---------------------------------------------------------------------------

export interface RunAgentTurnInput {
  workflowId: string;
  userInput: string;
  messages: ModelMessage[];
  clientId?: string;
  childWorkflowId?: string;
  activeAgent?: AgentName;
}

export interface RunAgentTurnOutput {
  interaction: ChatInteraction;
  messages: ModelMessage[];
  clientId?: string;
  childWorkflowId?: string;
  activeAgent: AgentName;
}

export async function runAgentTurn(input: RunAgentTurnInput): Promise<RunAgentTurnOutput> {
  const { workflowId, userInput, messages, clientId, childWorkflowId, activeAgent } = input;

  const clientContext: ClientContext = { clientId, childWorkflowId };
  const ctx: AgentRunContext = {
    clientContext,
    childWorkflowId,
    parentWorkflowId: workflowId,
    traceLines: [],
  };

  const updatedMessages: ModelMessage[] = [
    ...messages,
    { role: 'user', content: userInput },
  ];

  const { text, messages: finalMessages, activeAgent: nextAgent } =
    await runAgentLoop(activeAgent ?? 'supervisor', updatedMessages, ctx);

  const interaction: ChatInteraction = {
    user_prompt: userInput,
    text_response: text,
    agent_trace: ctx.traceLines.join('\n'),
  };

  return {
    interaction,
    messages: finalMessages,
    clientId: ctx.clientContext.clientId,
    childWorkflowId: ctx.childWorkflowId,
    activeAgent: nextAgent,
  };
}