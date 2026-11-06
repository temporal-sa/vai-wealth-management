// The approve_kyc tool only approves KYC after the customer has seen and confirmed their details
// for that account opening.
//
// The first tests call the check directly. The last one runs the real WealthManagementWorkflow with
// a scripted model that calls approve_kyc too early, and stand-in activities and Open Account
// workflows that record which account openings KYC was actually approved for.
//
// Requires the Temporal test server (downloaded automatically on first run). No Gemini API key or
// Redis needed.
import assert from 'assert';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { AiSdkPlugin } from '@temporalio/ai-sdk';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  ProviderV3,
} from '@ai-sdk/provider';
import { KYC_NOT_APPROVED, kycApprovalRefusal } from '../workflows/agent-loop';
import { validateNewAccount } from '../activities/investments';
import type { ChatInteraction, WealthManagementClient } from '../shared';
import { KycRecorderWorkflow, kycApprovedQuery, WealthManagementWorkflow } from './kyc-guard-workflows';

const OPENING = 'OpenAccount-chat-123-education-2';

describe('KYC guard', function () {
  it('refuses when the details were never shown for this opening', () => {
    assert.strictEqual(kycApprovalRefusal({}, OPENING, 3), KYC_NOT_APPROVED);
  });

  it('refuses when the details were only shown for an earlier opening', () => {
    assert.strictEqual(kycApprovalRefusal({ 'OpenAccount-chat-123-car-1': 2 }, OPENING, 3), KYC_NOT_APPROVED);
  });

  it("refuses in the turn the details were shown, before the customer replied", () => {
    assert.strictEqual(kycApprovalRefusal({ [OPENING]: 3 }, OPENING, 3), KYC_NOT_APPROVED);
  });

  it('approves once the customer replied after seeing the details', () => {
    assert.strictEqual(kycApprovalRefusal({ [OPENING]: 2 }, OPENING, 3), undefined);
  });
});

// ---------------------------------------------------------------------------
// Scripted model: each model call returns the next step of the script
// ---------------------------------------------------------------------------

type Step = { tool: string; args: Record<string, unknown> } | { text: string };

const tool = (name: string, args: Record<string, unknown> = {}): Step => ({ tool: name, args });
const message = (text: string): Step => ({ text });

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function scriptedProvider(script: Step[], toolResults: Array<{ toolName: string; output: string }>): ProviderV3 {
  let callNumber = 0;
  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'scripted',
    modelId: 'scripted',
    supportedUrls: {},
    async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
      // Record the tool results the model is shown, i.e. what the previous step's tools returned
      const last = options.prompt.at(-1);
      if (last?.role === 'tool') {
        for (const part of last.content) {
          if (part.type === 'tool-result') {
            toolResults.push({ toolName: part.toolName, output: JSON.stringify(part.output) });
          }
        }
      }
      const step = script.shift();
      if (!step) throw new Error('the model was called more often than scripted');
      callNumber += 1;
      if ('text' in step) {
        return {
          content: [{ type: 'text', text: step.text }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: USAGE,
          warnings: [],
        };
      }
      return {
        content: [{ type: 'tool-call', toolCallId: `call-${callNumber}`, toolName: step.tool, input: JSON.stringify(step.args) }],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
    async doStream() {
      throw new Error('not scripted');
    },
  };
  return {
    specificationVersion: 'v3',
    languageModel: () => model,
    embeddingModel: () => {
      throw new Error('not scripted');
    },
    imageModel: () => {
      throw new Error('not scripted');
    },
  } as ProviderV3;
}

describe('KYC guard in the supervisor workflow', function () {
  this.timeout(120_000);
  const TASK_QUEUE = 'kyc-guard-test';
  let env: TestWorkflowEnvironment;

  before(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  });

  after(async () => {
    await env?.teardown();
  });

  it('approves KYC only after the customer replies to their details for that opening', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const car = `OpenAccount-kyc-${suffix}-123-car-1`;
    const vacation = `OpenAccount-kyc-${suffix}-123-vacation-2`;
    const script: Step[] = [
      // Customer asks to open Car. The model shows their details, then approves KYC in the same
      // turn without waiting for the customer to answer.
      tool('handoff_to_investment_agent', { client_id: '123' }),
      tool('handoff_to_open_account_agent'),
      tool('get_current_client_info', { child_workflow_id: car }),
      tool('approve_kyc', { child_workflow_id: car }),
      message('Are these details correct?'),
      // Customer confirms.
      tool('approve_kyc', { child_workflow_id: car }),
      message('KYC approved.'),
      // Customer asks to open Vacation. The model treats the Car confirmation as approval for
      // this opening too.
      tool('get_current_client_info', { child_workflow_id: vacation }),
      tool('approve_kyc', { child_workflow_id: vacation }),
      message('Are these details still correct?'),
      // Customer confirms.
      tool('approve_kyc', { child_workflow_id: vacation }),
      message('KYC approved.'),
    ];
    const toolResults: Array<{ toolName: string; output: string }> = [];
    const interactions: ChatInteraction[] = [];
    const client: WealthManagementClient = {
      client_id: '123', first_name: 'Sam', last_name: 'Doe', address: '1 Main St',
      phone: '555', email: 's@example.com', marital_status: 'single',
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./kyc-guard-workflows'),
      plugins: [new AiSdkPlugin({ modelProvider: scriptedProvider(script, toolResults) })],
      bundlerOptions: { ignoreModules: ['@temporalio/activity', '@temporalio/client', 'crypto'] },
      activities: {
        async getLlmTaskQueue() {
          return TASK_QUEUE;
        },
        async getCurrentClientInfo() {
          return client;
        },
        async appendChatInteraction(_workflowId: string, interaction: ChatInteraction) {
          interactions.push(interaction);
          return interactions.length;
        },
        async appendStatusUpdate() {
          return 0;
        },
        async deleteConversation() {
          return true;
        },
      },
    });

    await worker.runUntil(async () => {
      // Stand-ins for the two account openings, which record the verify_kyc signal
      const openings = await Promise.all(
        [car, vacation].map((workflowId) =>
          env.client.workflow.start(KycRecorderWorkflow, { taskQueue: TASK_QUEUE, workflowId }),
        ),
      );
      const approved = async () => {
        const result: string[] = [];
        for (const opening of openings) {
          if (await opening.query(kycApprovedQuery)) result.push(opening.workflowId);
        }
        return result;
      };
      const chat = await env.client.workflow.start(WealthManagementWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `kyc-guard-${suffix}`,
        args: [],
      });
      // Sends a customer message and returns what approve_kyc returned during that turn
      const send = async (text: string): Promise<string[]> => {
        const before = interactions.length;
        const resultsBefore = toolResults.length;
        await chat.signal('process_user_message', { user_input: text });
        while (interactions.length === before) await new Promise((r) => setTimeout(r, 50));
        return toolResults.slice(resultsBefore).filter((r) => r.toolName === 'approve_kyc').map((r) => r.output);
      };

      let results = await send('Please open an account called Car.');
      assert.strictEqual(results.length, 1);
      assert.match(results[0], /KYC was not approved/);
      assert.deepStrictEqual(await approved(), []);

      results = await send("Yes, that's correct.");
      assert.match(results[0], /KYC approved/);
      assert.deepStrictEqual(await approved(), [car]);

      results = await send('Now open one called Vacation.');
      assert.match(results[0], /KYC was not approved/);
      assert.deepStrictEqual(await approved(), [car]);

      results = await send('Yes, still correct.');
      assert.match(results[0], /KYC approved/);
      assert.deepStrictEqual(await approved(), [car, vacation]);

      assert.deepStrictEqual(script, []);
      await chat.signal('end_workflow');
      await chat.result();
      await Promise.all(openings.map((opening) => opening.terminate('test finished')));
    });
  });
});

// get_account_opening_status answers from the states the openings reported with the
// update_account_opening_state signal, kept in the supervisor workflow. An unknown ID gets an answer
// instead of a failing query that would be retried forever.
describe('account opening status in the supervisor workflow', function () {
  this.timeout(120_000);
  const TASK_QUEUE = 'account-opening-status-test';
  let env: TestWorkflowEnvironment;

  before(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  });

  after(async () => {
    await env?.teardown();
  });

  it('reports the latest state of an opening, and says when there is no such opening', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const chatId = `account-opening-status-${suffix}`;
    const opening = `OpenAccount-${chatId}-123-College Fund-1`;
    const mistyped = `OpenAccount-${chatId}-123-College Fun-1`;
    const script: Step[] = [
      tool('handoff_to_investment_agent', { client_id: '123' }),
      tool('handoff_to_open_account_agent'),
      tool('get_account_opening_status', { workflow_id: opening }),
      tool('get_account_opening_status', { workflow_id: mistyped }),
      message('Your account is waiting for compliance review.'),
    ];
    const toolResults: Array<{ toolName: string; output: string }> = [];
    const interactions: ChatInteraction[] = [];
    // Calls to the Redis conversation activities, in order
    const conversationCalls: string[] = [];

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./kyc-guard-workflows'),
      plugins: [new AiSdkPlugin({ modelProvider: scriptedProvider(script, toolResults) })],
      bundlerOptions: { ignoreModules: ['@temporalio/activity', '@temporalio/client', 'crypto'] },
      activities: {
        async getLlmTaskQueue() {
          return TASK_QUEUE;
        },
        async appendChatInteraction(_workflowId: string, interaction: ChatInteraction) {
          conversationCalls.push('appendChatInteraction');
          interactions.push(interaction);
          return interactions.length;
        },
        async appendStatusUpdate(_workflowId: string, update: { status: string }) {
          conversationCalls.push(`appendStatusUpdate:${update.status}`);
          return 0;
        },
        async deleteConversation(workflowId: string) {
          conversationCalls.push(`deleteConversation:${workflowId}`);
          return true;
        },
      },
    });

    await worker.runUntil(async () => {
      const chat = await env.client.workflow.start(WealthManagementWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: chatId,
        args: [],
      });
      // As the Open Account workflow reports its state changes
      for (const state of ['Waiting KYC', 'Waiting Compliance Review']) {
        await chat.signal('update_account_opening_state', { account_name: 'College Fund', state, workflow_id: opening });
      }
      await chat.signal('process_user_message', { user_input: "What's the status of my College Fund account?" });
      while (interactions.length === 0) await new Promise((r) => setTimeout(r, 50));

      assert.deepStrictEqual(
        toolResults.filter((r) => r.toolName === 'get_account_opening_status').map((r) => JSON.parse(r.output).value),
        [
          'Waiting Compliance Review',
          `No account opening with workflow ID ${mistyped} was found in this conversation.`,
        ],
      );
      assert.deepStrictEqual(script, []);

      await chat.signal('end_workflow');
      await chat.result();
      // The conversation is cleared when the chat starts (its ID may have been used before) and when it ends
      assert.deepStrictEqual(conversationCalls, [
        `deleteConversation:${chatId}`,
        'appendStatusUpdate:New College Fund account status changed: Waiting KYC',
        'appendStatusUpdate:New College Fund account status changed: Waiting Compliance Review',
        'appendChatInteraction',
        `deleteConversation:${chatId}`,
      ]);
    });
  });
});

// Every request to open an account starts a new account opening (a new Open Account workflow) with
// its own KYC, even when an opening with the same name is still in progress. Runs the real supervisor
// and Open Account workflows with a scripted model; the activities are stand-ins (no data files).
describe('opening the same account twice in a conversation', function () {
  this.timeout(120_000);
  const TASK_QUEUE = 'repeat-opening-test';
  let env: TestWorkflowEnvironment;

  before(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  });

  after(async () => {
    await env?.teardown();
  });

  it('starts a second Vacation opening that needs its own KYC', async () => {
    const chatId = `repeat-opening-${Math.random().toString(36).slice(2)}`;
    const first = `OpenAccount-${chatId}-123-Vacation-1`;
    const second = `OpenAccount-${chatId}-123-Vacation-2`;
    const open = (initial_amount: number) =>
      tool('open_new_investment_account', { client_id: '123', account_name: 'Vacation', initial_amount });
    const script: Step[] = [
      // "Open Vacation with $13,000"
      tool('handoff_to_investment_agent', { client_id: '123' }),
      tool('handoff_to_open_account_agent'),
      open(13000),
      tool('get_current_client_info', { child_workflow_id: first }),
      message('Are these details correct?'),
      // "Yes"
      tool('approve_kyc', { child_workflow_id: first }),
      message('Your account is waiting for compliance review.'),
      // "Open Vacation with $13,000". A refused opening doesn't use up a number. The model then
      // treats the earlier confirmation as approval for the new opening.
      open(50),
      open(13000),
      tool('approve_kyc', { child_workflow_id: second }),
      tool('get_current_client_info', { child_workflow_id: second }),
      message('Are these details still correct?'),
      // "Yes"
      tool('approve_kyc', { child_workflow_id: second }),
      message('Your account is waiting for compliance review.'),
    ];
    const toolResults: Array<{ toolName: string; output: string }> = [];
    const interactions: ChatInteraction[] = [];
    const client: WealthManagementClient = {
      client_id: '123', first_name: 'Sam', last_name: 'Doe', address: '1 Main St',
      phone: '555', email: 's@example.com', marital_status: 'single',
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./kyc-guard-workflows'),
      plugins: [new AiSdkPlugin({ modelProvider: scriptedProvider(script, toolResults) })],
      bundlerOptions: { ignoreModules: ['@temporalio/activity', '@temporalio/client', 'crypto'] },
      activities: {
        validateNewAccount,
        async findPromotion() {
          return null;
        },
        async getOpenAccountTaskQueue() {
          return null; // the Open Account workflows run on this worker
        },
        async getLlmTaskQueue() {
          return TASK_QUEUE;
        },
        async getClient() {
          return client;
        },
        async getCurrentClientInfo(childWorkflowId: string) {
          return env.client.workflow.getHandle(childWorkflowId).executeUpdate('get_client_details');
        },
        async appendChatInteraction(_workflowId: string, interaction: ChatInteraction) {
          interactions.push(interaction);
          return interactions.length;
        },
        async appendStatusUpdate() {
          return 0;
        },
        async deleteConversation() {
          return true;
        },
      },
    });

    await worker.runUntil(async () => {
      const chat = await env.client.workflow.start(WealthManagementWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: chatId,
        args: [],
      });
      // Sends a customer message and returns the tool results of that turn
      const send = async (text: string): Promise<Array<{ toolName: string; output: string }>> => {
        const before = interactions.length;
        const resultsBefore = toolResults.length;
        await chat.signal('process_user_message', { user_input: text });
        while (interactions.length === before) await new Promise((r) => setTimeout(r, 50));
        return toolResults.slice(resultsBefore);
      };
      const outputs = (results: Array<{ toolName: string; output: string }>, toolName: string) =>
        results.filter((r) => r.toolName === toolName).map((r) => r.output);
      // Waits for an opening to reach a state, and returns the state it is in
      const stateOf = async (workflowId: string, expected: string): Promise<string> => {
        let state = '';
        for (let i = 0; i < 100 && state !== expected; i++) {
          state = await env.client.workflow.getHandle(workflowId).query<string>('get_current_state');
          if (state !== expected) await new Promise((r) => setTimeout(r, 50));
        }
        return state;
      };

      let results = await send('Open Vacation with $13,000');
      assert.match(outputs(results, 'open_new_investment_account')[0], new RegExp(`"child_workflow_id":"${first}"`));
      assert.match(outputs(results, 'get_current_client_info')[0], /Sam/);

      results = await send('Yes');
      assert.match(outputs(results, 'approve_kyc')[0], /KYC approved/);
      assert.strictEqual(await stateOf(first, 'Waiting Compliance Review'), 'Waiting Compliance Review');

      results = await send('Open Vacation with $13,000');
      const opened = outputs(results, 'open_new_investment_account');
      assert.match(opened[0], /cannot be opened/);
      assert.match(opened[1], new RegExp(`"child_workflow_id":"${second}"`));
      // The confirmation for the first opening doesn't count for the second
      assert.match(outputs(results, 'approve_kyc')[0], /KYC was not approved/);
      assert.strictEqual(await stateOf(second, 'Waiting KYC'), 'Waiting KYC');
      assert.match(outputs(results, 'get_current_client_info')[0], /Sam/);

      results = await send('Yes');
      assert.match(outputs(results, 'approve_kyc')[0], /KYC approved/);
      assert.strictEqual(await stateOf(second, 'Waiting Compliance Review'), 'Waiting Compliance Review');

      // Both openings are running at the same time
      for (const workflowId of [first, second]) {
        const { status, type } = await env.client.workflow.getHandle(workflowId).describe();
        assert.strictEqual(type, 'OpenInvestmentAccountWorkflow');
        assert.strictEqual(status.name, 'RUNNING');
      }
      assert.deepStrictEqual(script, []);

      await chat.signal('end_workflow');
      await chat.result();
    });
  });
});
