// Live test of opening the same account twice in one conversation, against the real Gemini model.
//
// The customer looks at their beneficiaries and investments, asks to open "Vacation" with $13,000,
// confirms their details, then asks to open "Vacation" with $13,000 again while the first opening is
// waiting for compliance review. Every request to open an account starts a new account opening with
// its own KYC, so the second request must start a second Open Account workflow and show the client's
// details again, instead of the model answering from the conversation history.
//
// The model decides whether to call the tool, so this can't be checked with a scripted model (see
// kyc-guard.test.ts for the scripted version). It runs the real WealthManagementWorkflow and
// OpenInvestmentAccountWorkflow with real Gemini calls. Activities that read data/*.json are real;
// the ones that would write data/*.json, use Redis (chat history, chaos flags) or connect to another
// Temporal server are stubbed.
//
// Not part of `npm test`, because it calls the paid Gemini API. Run it with:
//   source setllmkey.sh && npm run test:live
// LIVE_TEST_RUNS=<n> repeats the conversation n times (default 1), since model output varies.
// Requires the Temporal test server (downloaded automatically on first run).
import assert from 'assert';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { AiSdkPlugin } from '@temporalio/ai-sdk';
import { google } from '@ai-sdk/google';
import { BeneficiariesManager } from '../../common/beneficiaries-manager';
import { InvestmentManager } from '../../common/investment-manager';
import { get_client, validate_new_account } from '../activities/activities';
import type { ChatInteraction, WealthManagementClient } from '../shared';
import { WealthManagementWorkflow } from '../workflows/wealth-management';

const RUNS = Math.max(1, Number(process.env.LIVE_TEST_RUNS ?? 1));
const OPEN_VACATION = 'Open Vacation with $13,000';
// Client 123 in data/clients.json
const KYC_DETAILS = ['Don', '123 Main Street'];

// Stands in for an activity that must not run in this test (it would change data/*.json)
function mustNotRun(name: string) {
  return async () => {
    throw new Error(`${name} must not run in the live test: it would change data/*.json`);
  };
}

describe('Opening the same account twice (live Gemini)', function () {
  this.timeout(RUNS * 300_000 + 60_000);
  const TASK_QUEUE = 'repeat-opening-live-test';
  let env: TestWorkflowEnvironment;

  before(async function () {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      this.skip(); // no key: source setllmkey.sh first
    }
    env = await TestWorkflowEnvironment.createLocal();
  });

  after(async () => {
    await env?.teardown();
  });

  it('starts a new account opening with its own KYC for each request', async () => {
    const interactions: ChatInteraction[] = [];
    const beneficiaries = new BeneficiariesManager();
    const investments = new InvestmentManager();
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('../workflows/index'),
      plugins: [new AiSdkPlugin({ modelProvider: google })],
      bundlerOptions: { ignoreModules: ['@temporalio/activity', '@temporalio/client', 'crypto'] },
      activities: {
        // Read data/*.json, without the chaos flags (Redis)
        async list_beneficiaries(clientId: string) {
          return beneficiaries.listBeneficiaries(clientId);
        },
        async list_investments(clientId: string) {
          return investments.listInvestmentAccounts(clientId);
        },
        validate_new_account,
        async find_promotion() {
          return null; // chaos off: no promo-code bug
        },
        get_client,
        // The Open Account workflows run on this worker, and the model calls too
        async get_open_account_task_queue() {
          return null;
        },
        async get_llm_task_queue() {
          return TASK_QUEUE;
        },
        // Through the test server instead of the configured Temporal server
        async get_current_client_info(childWorkflowId: string): Promise<WealthManagementClient | null> {
          return env.client.workflow.getHandle(childWorkflowId).executeUpdate('get_client_details');
        },
        async approve_kyc(childWorkflowId: string) {
          await env.client.workflow.getHandle(childWorkflowId).signal('verify_kyc');
        },
        // The conversation kept in memory instead of Redis
        async append_chat_interaction(_workflowId: string, interaction: ChatInteraction) {
          interactions.push(interaction);
          return interactions.length;
        },
        async append_status_update() {
          return 0;
        },
        async delete_conversation() {
          return true;
        },
        add_beneficiary: mustNotRun('add_beneficiary'),
        delete_beneficiary: mustNotRun('delete_beneficiary'),
        close_investment: mustNotRun('close_investment'),
        update_client_details: mustNotRun('update_client_details'),
        update_client: mustNotRun('update_client'),
        open_investment: mustNotRun('open_investment'),
        remove_investment: mustNotRun('remove_investment'),
        debit_linked_account: mustNotRun('debit_linked_account'),
        credit_linked_account: mustNotRun('credit_linked_account'),
        register_account: mustNotRun('register_account'),
      },
    });

    await worker.runUntil(async () => {
      for (let run = 1; run <= RUNS; run++) {
        const chatId = `repeat-opening-live-${run}-${Math.random().toString(36).slice(2)}`;
        const chat = await env.client.workflow.start(WealthManagementWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: chatId,
          args: [],
        });
        const send = async (text: string): Promise<ChatInteraction> => {
          const before = interactions.length;
          await chat.signal('process_user_message', { user_input: text });
          while (interactions.length === before) await new Promise((r) => setTimeout(r, 100));
          return interactions[interactions.length - 1];
        };
        const transcript: string[] = [];
        const interactionsBefore = interactions.length;
        const say = async (text: string) => {
          const reply = await send(text);
          transcript.push(`Customer: ${text}`, `Agent: ${reply.text_response}`, `  trace: ${reply.agent_trace}`);
          return reply;
        };
        const context = () => `\nRun ${run} of ${RUNS}:\n${transcript.join('\n')}`;
        // The Open Account workflows this chat started, from the open_new_investment_account traces,
        // checked against the server
        const openings = async (): Promise<string[]> => {
          const traces = interactions.slice(interactionsBefore).map((i) => i.agent_trace ?? '').join('\n');
          const ids = [...traces.matchAll(/open_new_investment_account\([^)]*\) → (OpenAccount-[^\n]+)/g)].map((m) => m[1]);
          for (const id of ids) {
            const { type } = await env.client.workflow.getHandle(id).describe();
            assert.strictEqual(type, 'OpenInvestmentAccountWorkflow');
          }
          return ids;
        };

        try {
          await say('Who are my beneficiaries?');
          await say('123');
          await say('what investments do I have?');
          const first = await say(OPEN_VACATION);
          for (const detail of KYC_DETAILS) {
            assert.ok(first.text_response.includes(detail), `KYC details (${detail}) not shown for the first opening${context()}`);
          }
          await say('Yes');
          const second = await say(OPEN_VACATION);
          for (const detail of KYC_DETAILS) {
            assert.ok(second.text_response.includes(detail), `KYC details (${detail}) not shown for the second opening${context()}`);
          }

          const ids = await openings();
          transcript.push(`Account openings started: ${ids.join(', ')}`);
          assert.strictEqual(ids.length, 2, `expected two account openings, got ${JSON.stringify(ids)}${context()}`);
          assert.ok(ids[0].endsWith('-Vacation-1'), `first opening: ${ids[0]}${context()}`);
          assert.ok(ids[1].endsWith('-Vacation-2'), `second opening: ${ids[1]}${context()}`);
        } finally {
          console.log(context());
        }

        await chat.signal('end_workflow');
        await chat.result();
      }
    });
  });
});
