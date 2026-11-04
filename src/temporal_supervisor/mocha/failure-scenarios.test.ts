import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { APICallError } from 'ai';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { activityInfo } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import type { WorkflowHandle } from '@temporalio/client';
import { temporal } from '@temporalio/proto';
import { FundingManager, InsufficientFundsError } from '../../common/funding-manager';
import { translateModelError } from '../chaos-model';
import { validateNewAccount } from '../activities/investments';
import { InvestmentManager } from '../../common/investment-manager';
import { openAccountWorkflowId } from '../workflows/start-open-account';
import type { OpenInvestmentAccountInput, OpenInvestmentAccountOutput, WealthManagementClient } from '../shared';
import { OpenInvestmentAccountWorkflow, StartOpenAccountTwiceWorkflow, TestParentWorkflow } from './test-workflows';

const TASK_QUEUE = 'failure-scenarios-test';
const CLIENT_ID = '123';
const INVESTMENT_ID = 'i-test';
const CLIENT: WealthManagementClient = {
  client_id: CLIENT_ID,
  first_name: 'Jane',
  last_name: 'Doe',
  address: '1 Main St',
  phone: '555-0199',
  email: 'jane@example.com',
  marital_status: 'single',
};

// Stand-ins for the real activities, registered under the same names. They record the order
// they were called in and fail on demand: "reject" fails non-retryably, a number N fails the
// first N attempts.
function fakeActivities(calls: string[], failures: Record<string, 'reject' | number> = {}) {
  function maybeFail(name: string) {
    const behavior = failures[name];
    if (behavior === 'reject') throw ApplicationFailure.nonRetryable(`${name} rejected`, 'Rejected');
    const { attempt } = activityInfo();
    if (typeof behavior === 'number' && attempt <= behavior) {
      calls.push(`${name} attempt ${attempt} failed`);
      throw new Error(`${name} unavailable`);
    }
  }
  return {
    async getClient() {
      return CLIENT;
    },
    async updateClient(_clientId: string, fields: Partial<WealthManagementClient>) {
      calls.push(`updateClient:${JSON.stringify(fields)}`);
      return { ...CLIENT, ...fields };
    },
    async openInvestment(_clientId: string, name: string, balance: number) {
      maybeFail('openInvestment');
      calls.push(`openInvestment:${name}/${balance}`);
      return { investment_id: INVESTMENT_ID, name, balance };
    },
    async closeInvestment(_clientId: string, investmentId: string) {
      calls.push(`closeInvestment:${investmentId}`);
      return true;
    },
    async debitLinkedAccount(_clientId: string, amount: number, transferId: string) {
      calls.push(`debit:${amount}/${transferId}`);
      maybeFail('debitLinkedAccount');
      return {};
    },
    async creditLinkedAccount(_clientId: string, amount: number, transferId: string) {
      calls.push(`credit:${amount}/${transferId}`);
      return {};
    },
    async registerAccount(_clientId: string, investmentId: string) {
      calls.push(`register:${investmentId}`);
      maybeFail('registerAccount');
      return `CUST-${investmentId}`;
    },
  };
}

// The idempotency key of the initial deposit: unique per run, since the workflow ID is reused when
// the same account is opened again in a chat
async function initialDepositId(child: WorkflowHandle): Promise<string> {
  const { runId } = await child.describe();
  return `${child.workflowId}-${runId}-initial-deposit`;
}

describe('failure scenarios', function () {
  this.timeout(60_000);
  let env: TestWorkflowEnvironment;

  before(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  });

  after(async () => {
    await env?.teardown();
  });

  // Starts a parent and an Open Account workflow, approves KYC and compliance, and runs the
  // worker while `body` waits for the outcome.
  async function runOpenAccount<T>(
    activities: object,
    promoCode: string | null,
    body: (child: WorkflowHandle, parent: WorkflowHandle) => Promise<T>,
    childWorkflowId?: string,
  ): Promise<T> {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./test-workflows'),
      activities,
    });
    return worker.runUntil(async () => {
      const suffix = Math.random().toString(36).slice(2);
      const parent = await env.client.workflow.start(TestParentWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `parent-${suffix}`,
      });
      const input: OpenInvestmentAccountInput = {
        client_id: CLIENT_ID,
        account_name: 'College Fund',
        initial_amount: 1000,
        parent_workflow_id: parent.workflowId,
        promo_code: promoCode,
      };
      const child = await env.client.workflow.start(OpenInvestmentAccountWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: childWorkflowId ?? `open-account-${suffix}`,
        args: [input],
      });
      await child.signal('verify_kyc');
      await child.signal('compliance_approved');
      return body(child, parent);
    });
  }

  it('opens the account when every saga step succeeds', async () => {
    const calls: string[] = [];
    await runOpenAccount(fakeActivities(calls), null, async (child, parent) => {
      const result: OpenInvestmentAccountOutput = await child.result();
      assert.deepStrictEqual(result, { account_created: true, message: 'investment account created' });
      const transferId = await initialDepositId(child);
      assert.deepStrictEqual(calls, [
        'openInvestment:College Fund/1000',
        `debit:1000/${transferId}`,
        `register:${INVESTMENT_ID}`,
      ]);
      const statuses: string[] = await parent.result();
      assert.deepStrictEqual(statuses, [
        'New College Fund account status changed: Waiting KYC',
        'New College Fund account status changed: Waiting Compliance Review',
        'New College Fund account status changed: Compliance review has been approved. Creating Investment Account',
        'New College Fund account status changed: Creating the account record.',
        'New College Fund account status changed: Transferring $1,000.00 from the linked bank account.',
        'New College Fund account status changed: Registering the account with the custodian.',
        'New College Fund account status changed: Complete',
      ]);
      assert.strictEqual(await child.query('get_current_state'), 'Complete');
    });
  });

  it('rolls back completed steps in reverse order when the custodian rejects the account', async () => {
    const calls: string[] = [];
    await runOpenAccount(fakeActivities(calls, { registerAccount: 'reject' }), null, async (child, parent) => {
      const result: OpenInvestmentAccountOutput = await child.result();
      assert.deepStrictEqual(result, {
        account_created: false,
        message: 'The account was not opened: registerAccount rejected',
      });
      const transferId = await initialDepositId(child);
      assert.deepStrictEqual(calls, [
        'openInvestment:College Fund/1000',
        `debit:1000/${transferId}`,
        `register:${INVESTMENT_ID}`,
        `credit:1000/${transferId}-refund`,
        `closeInvestment:${INVESTMENT_ID}`,
      ]);
      assert.strictEqual(
        await child.query('get_current_state'),
        'Rolled back. The account was not opened: registerAccount rejected.',
      );
      const statuses: string[] = await parent.result();
      assert.deepStrictEqual(statuses.slice(-4), [
        'New College Fund account status changed: Failed: registerAccount rejected. Rolling back.',
        'New College Fund account status changed: Rolling back: refunding $1,000.00 to the linked bank account.',
        'New College Fund account status changed: Rolling back: removing the account record.',
        'New College Fund account status changed: Rolled back. The account was not opened: registerAccount rejected.',
      ]);
    });
  });

  it('undoes only the steps that completed', async () => {
    const calls: string[] = [];
    await runOpenAccount(fakeActivities(calls, { debitLinkedAccount: 'reject' }), null, async (child) => {
      const result: OpenInvestmentAccountOutput = await child.result();
      assert.strictEqual(result.account_created, false);
      // The debit never happened, so there is nothing to refund
      assert.deepStrictEqual(calls, [
        'openInvestment:College Fund/1000',
        `debit:1000/${await initialDepositId(child)}`,
        `closeInvestment:${INVESTMENT_ID}`,
      ]);
    });
  });

  it('retries transient failures instead of rolling back', async () => {
    const calls: string[] = [];
    await runOpenAccount(fakeActivities(calls, { openInvestment: 2 }), null, async (child) => {
      const result: OpenInvestmentAccountOutput = await child.result();
      assert.strictEqual(result.account_created, true);
      assert.deepStrictEqual(calls.slice(0, 3), [
        'openInvestment attempt 1 failed',
        'openInvestment attempt 2 failed',
        'openInvestment:College Fund/1000',
      ]);
    });
  });

  it('moves money again when the same account is reopened after a rollback', async () => {
    const childWorkflowId = `open-account-reopen-${Math.random().toString(36).slice(2)}`;
    const first: string[] = [];
    await runOpenAccount(fakeActivities(first, { registerAccount: 'reject' }), null, (child) => child.result(), childWorkflowId);
    const second: string[] = [];
    await runOpenAccount(fakeActivities(second), null, (child) => child.result(), childWorkflowId);
    const debitOf = (calls: string[]) => calls.find((c) => c.startsWith('debit:'));
    assert.ok(debitOf(first) && debitOf(second));
    // Same workflow ID, different runs: a reused transfer ID would return the refunded transfer
    assert.notStrictEqual(debitOf(first), debitOf(second));
  });

  it('waits for the client to load before returning client details', async () => {
    const calls: string[] = [];
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./test-workflows'),
      activities: fakeActivities(calls),
    });
    await worker.runUntil(async () => {
      const suffix = Math.random().toString(36).slice(2);
      const parent = await env.client.workflow.start(TestParentWorkflow, { taskQueue: TASK_QUEUE, workflowId: `parent-${suffix}` });
      const child = await env.client.workflow.start(OpenInvestmentAccountWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `open-account-${suffix}`,
        args: [{ client_id: CLIENT_ID, account_name: 'College Fund', initial_amount: 1000, parent_workflow_id: parent.workflowId }],
      });
      // Asked right after the start, before the getClient activity has run
      const details = await child.executeUpdate<WealthManagementClient | null, []>('get_client_details');
      assert.deepStrictEqual(details, CLIENT);
      await child.terminate('test finished');
      await parent.terminate('test finished');
    });
  });

  it('saves updated client details and approves KYC', async () => {
    const calls: string[] = [];
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./test-workflows'),
      activities: fakeActivities(calls),
    });
    await worker.runUntil(async () => {
      const suffix = Math.random().toString(36).slice(2);
      const parent = await env.client.workflow.start(TestParentWorkflow, { taskQueue: TASK_QUEUE, workflowId: `parent-${suffix}` });
      const child = await env.client.workflow.start(OpenInvestmentAccountWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `open-account-${suffix}`,
        args: [{ client_id: CLIENT_ID, account_name: 'College Fund', initial_amount: 1000, parent_workflow_id: parent.workflowId }],
      });
      const saved = await child.executeUpdate<WealthManagementClient | null, [Partial<WealthManagementClient>]>(
        'update_client_details',
        { args: [{ phone: '555-0100' }] },
      );
      assert.deepStrictEqual(saved, { ...CLIENT, phone: '555-0100' });
      assert.deepStrictEqual(calls, ['updateClient:{"phone":"555-0100"}']);
      // No verify_kyc signal needed: the workflow moves on to compliance review
      let state = '';
      for (let i = 0; i < 40 && state !== 'Waiting Compliance Review'; i++) {
        state = await child.query<string>('get_current_state');
        if (state !== 'Waiting Compliance Review') await new Promise((r) => setTimeout(r, 100));
      }
      assert.strictEqual(state, 'Waiting Compliance Review');
      await child.terminate('test finished');
      await parent.terminate('test finished');
    });
  });

  it('pauses on the promo-code bug instead of failing the workflow', async () => {
    const calls: string[] = [];
    await runOpenAccount(fakeActivities(calls), 'WELCOME-BONUS', async (child) => {
      let failure: string | null | undefined;
      for (let i = 0; i < 40 && !failure; i++) {
        const history = await child.fetchHistory();
        failure = history.events?.find((e) => e.workflowTaskFailedEventAttributes)
          ?.workflowTaskFailedEventAttributes?.failure?.message;
        if (!failure) await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(failure, 'the demo bug should fail the workflow task');
      assert.match(failure, /rate/);
      // Paused, not failed: still running, and the saga never started
      const { status } = await child.describe();
      assert.strictEqual(status.code, temporal.api.enums.v1.WorkflowExecutionStatus.WORKFLOW_EXECUTION_STATUS_RUNNING);
      assert.deepStrictEqual(calls, []);
      await child.terminate('test finished');
    });
  });

  it('starts one Open Account workflow per account in a chat, however often the tool is called', async () => {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./test-workflows'),
      activities: fakeActivities([]),
    });
    await worker.runUntil(async () => {
      const accountName = `Car ${Math.random().toString(36).slice(2)}`;
      const parentWorkflowId = `start-twice-${Math.random().toString(36).slice(2)}`;
      const childWorkflowId = openAccountWorkflowId(parentWorkflowId, CLIENT_ID, accountName);
      const start = (times: number) =>
        env.client.workflow.execute(StartOpenAccountTwiceWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: parentWorkflowId,
          args: [
            { client_id: CLIENT_ID, account_name: accountName, initial_amount: 1000, parent_workflow_id: parentWorkflowId, promo_code: null },
            times,
          ],
        });

      assert.deepStrictEqual(await start(2), [
        { childWorkflowId, alreadyRunning: false },
        { childWorkflowId, alreadyRunning: true },
      ]);

      // The child is terminated with its parent; after that the same chat can open the account again
      const child = env.client.workflow.getHandle(childWorkflowId);
      while ((await child.describe()).status.name === 'RUNNING') {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.deepStrictEqual(await start(1), [{ childWorkflowId, alreadyRunning: false }]);
    });
  });

  it('derives the workflow ID from the chat, client and account name', () => {
    assert.strictEqual(
      openAccountWorkflowId('chat-1', '123', '  Kids College Fund! '),
      'OpenAccount-chat-1-123-kids-college-fund',
    );
    assert.strictEqual(openAccountWorkflowId('chat-1', '123', 'car'), openAccountWorkflowId('chat-1', '123', 'Car'));
    // Two chats for the same client and account name don't collide
    assert.notStrictEqual(openAccountWorkflowId('chat-1', '123', 'Car'), openAccountWorkflowId('chat-2', '123', 'Car'));
  });
});

describe('business rules', () => {
  async function failureOf(amount: number, accountName = 'College Fund'): Promise<ApplicationFailure> {
    try {
      await validateNewAccount(CLIENT_ID, accountName, amount);
    } catch (err) {
      assert.ok(err instanceof ApplicationFailure);
      return err;
    }
    assert.fail(`expected $${amount} to be rejected`);
  }

  it('rejects deposits over $1,000,000 without retrying', async () => {
    const failure = await failureOf(2_000_000);
    assert.strictEqual(failure.type, 'DepositLimitExceeded');
    assert.strictEqual(failure.nonRetryable, true);
  });

  it('rejects deposits under $100 without retrying', async () => {
    const failure = await failureOf(50);
    assert.strictEqual(failure.type, 'DepositTooSmall');
    assert.strictEqual(failure.nonRetryable, true);
  });

  it('accepts deposits within the limits', async () => {
    await validateNewAccount(CLIENT_ID, 'College Fund', 1000);
  });

  it('rejects a name the client already has, ignoring case and spaces', async () => {
    const [existing] = new InvestmentManager().listInvestmentAccounts(CLIENT_ID);
    assert.ok(existing, `client ${CLIENT_ID} needs at least one account in data/investments.json`);
    const failure = await failureOf(1000, `  ${existing.name.toUpperCase()} `);
    assert.strictEqual(failure.type, 'DuplicateAccountName');
    assert.strictEqual(failure.nonRetryable, true);
  });
});

describe('funding transfers', () => {
  let file: string;
  let funding: FundingManager;

  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'funding-')), 'funding-accounts.json');
    fs.writeFileSync(file, JSON.stringify({ accounts: { [CLIENT_ID]: { name: 'Checking', balance: 1000 } }, transfers: {} }));
    funding = new FundingManager(file);
  });

  it('applies each transfer ID only once', () => {
    funding.debit(CLIENT_ID, 300, 't-1');
    funding.debit(CLIENT_ID, 300, 't-1');
    funding.credit(CLIENT_ID, 300, 't-1-refund');
    funding.credit(CLIENT_ID, 300, 't-1-refund');
    assert.strictEqual(funding.getAccount(CLIENT_ID).balance, 1000);
  });

  it('refuses to overdraw the linked account', () => {
    assert.throws(() => funding.debit(CLIENT_ID, 5000, 't-2'), InsufficientFundsError);
    assert.strictEqual(funding.getAccount(CLIENT_ID).balance, 1000);
  });
});

describe('model rate limits', () => {
  it('turns an HTTP 429 into a retryable failure that waits 15 seconds', () => {
    const error = new APICallError({
      message: 'Resource exhausted',
      url: 'https://generativelanguage.googleapis.com',
      requestBodyValues: {},
      statusCode: 429,
    });
    const translated = translateModelError(error);
    assert.ok(translated instanceof ApplicationFailure);
    assert.strictEqual(translated.type, 'ModelRateLimited');
    assert.strictEqual(translated.nonRetryable, false);
    assert.strictEqual(translated.nextRetryDelay, '15s');
  });

  it('leaves other errors alone', () => {
    const error = new Error('boom');
    assert.strictEqual(translateModelError(error), error);
  });
});
