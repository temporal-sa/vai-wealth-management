// Live test of the agent handoffs, against the real Gemini model.
//
// A customer starts with the Beneficiary Agent, then asks about their investments. The
// Beneficiary Agent should hand the conversation back to the supervisor, which hands it to the
// Investment Agent, all in the same turn, so the reply lists the investment accounts. It must
// not ask the customer whether they want to be transferred.
//
// The model decides whether to hand off, so this can't be checked with a scripted model. It runs
// the real WealthManagementWorkflow with real Gemini calls and the real beneficiary and
// investment activities (which only read data/*.json).
//
// Not part of `npm test`, because it calls the paid Gemini API. Run it with:
//   source setllmkey.sh && npm run test:live
// LIVE_TEST_RUNS=<n> repeats the conversation n times (default 1), since model output varies.
// Requires the Temporal test server (downloaded automatically on first run). Redis is optional:
// without it, the chaos flags read as off.
import assert from 'assert';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { AiSdkPlugin } from '@temporalio/ai-sdk';
import { google } from '@ai-sdk/google';
import * as activities from '../activities/activities';
import type { ChatInteraction } from '../shared';
import { WealthManagementWorkflow } from '../workflows/wealth-management';

const RUNS = Math.max(1, Number(process.env.LIVE_TEST_RUNS ?? 1));
// Client 123's accounts in data/investments.json
const CLIENT_123_ACCOUNTS = ['Checking', 'Savings', '401K'];
const CLIENT_123_BENEFICIARIES = ['John', 'Jane', 'Joan'];

describe('Agent handoffs (live Gemini)', function () {
  this.timeout(RUNS * 180_000 + 60_000);
  const TASK_QUEUE = 'agent-handoffs-live-test';
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

  it('answers an investment question asked while talking to the Beneficiary Agent', async () => {
    const interactions: ChatInteraction[] = [];
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('../workflows/index'),
      plugins: [new AiSdkPlugin({ modelProvider: google })],
      bundlerOptions: { ignoreModules: ['@temporalio/activity', '@temporalio/client', 'crypto'] },
      activities: {
        ...activities,
        // Model calls on this worker's queue, and the conversation kept in memory instead of Redis
        async getLlmTaskQueue() {
          return TASK_QUEUE;
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
      for (let run = 1; run <= RUNS; run++) {
        const chat = await env.client.workflow.start(WealthManagementWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: `agent-handoffs-live-${run}-${Math.random().toString(36).slice(2)}`,
          args: [],
        });
        const send = async (text: string): Promise<ChatInteraction> => {
          const before = interactions.length;
          await chat.signal('process_user_message', { user_input: text });
          while (interactions.length === before) await new Promise((r) => setTimeout(r, 100));
          return interactions[interactions.length - 1];
        };
        const transcript: string[] = [];
        const say = async (text: string) => {
          const reply = await send(text);
          transcript.push(`Customer: ${text}`, `Agent: ${reply.text_response}`, `  trace: ${reply.agent_trace}`);
          return reply;
        };
        const context = () => `\nRun ${run} of ${RUNS}:\n${transcript.join('\n')}`;

        await say('Who are my beneficiaries?');
        const beneficiaries = await say('123');
        for (const name of CLIENT_123_BENEFICIARIES) {
          assert.ok(beneficiaries.text_response.includes(name), `beneficiary ${name} not listed${context()}`);
        }

        const investments = await say('What investments do I have?');
        for (const account of CLIENT_123_ACCOUNTS) {
          assert.ok(investments.text_response.includes(account), `account ${account} not listed${context()}`);
        }
        assert.doesNotMatch(investments.text_response, /transfer/i, `the agent talked about a transfer${context()}`);
        // The Beneficiary Agent should hand off without announcing it, even though a later agent's
        // reply would hide what it said
        assert.doesNotMatch(investments.agent_trace ?? '', /\[Beneficiary Agent\]:[^\n]*transfer/i,
          `the Beneficiary Agent announced the transfer instead of just handing off${context()}`);
        assert.match(investments.agent_trace ?? '', /Handed off from .* to Investment Agent/, `no handoff to the Investment Agent${context()}`);
        // Asked once, at the start
        assert.doesNotMatch(investments.text_response, /client id/i, `asked for the client ID again${context()}`);

        await chat.signal('end_workflow');
        await chat.result();
        console.log(context());
      }
    });
  });
});
