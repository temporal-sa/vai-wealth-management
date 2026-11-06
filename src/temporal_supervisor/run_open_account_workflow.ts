/**
 * Exercise OpenInvestmentAccountWorkflow on its own, without the chat or the LLM.
 *
 * Starts the open-account workflow directly for three scenarios:
 *
 * 1. KYC approved (verify_kyc signal), then compliance approved.
 * 2. Client details read (get_client_details update) and changed (update_client_details update,
 *    which also completes KYC), then compliance approved.
 * 3. KYC approved, then waits until you send the compliance approval yourself
 *    (localsendcomplianceapproval.sh <workflow ID>).
 *
 * The workflow is started on TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT (default: the main task queue), so it
 * runs on whichever worker polls that queue: the TypeScript worker, or the Java worker in java/ when
 * the queues are split. The activities it calls run on the TypeScript worker's main task queue, so a
 * TypeScript worker must be running. There is no chat workflow, so the workflow has no parent to send
 * its status updates to; each state change is printed here instead (from the get_current_state query).
 *
 * The scenarios change data/*.json like the demo does (client 123's last name, a new account, the
 * linked bank account balance); reset with `git checkout data/`.
 *
 * Usage (from the project root; see startlocalopenaccount.sh):
 *   npm run open-account.scenarios -- [--scenario N ...] [--amount X]
 */
import { randomUUID } from 'crypto';
import type { Client, WorkflowHandle } from '@temporalio/client';
import { ClientHelper } from '../common/client-helper';
import type { OpenInvestmentAccountInput, OpenInvestmentAccountOutput, WealthManagementClient } from './shared';
import type { OpenInvestmentAccountWorkflow } from './workflows/open-account';

const CLIENT_ID = '123';
const WAITING_KYC = 'Waiting KYC';
const WAITING_COMPLIANCE_REVIEW = 'Waiting Compliance Review';
// Account name and initial deposit of each scenario
const SCENARIOS: Record<number, { accountName: string; amount: number }> = {
  1: { accountName: 'Vacation', amount: 150.78 },
  2: { accountName: 'Vacation2', amount: 350.72 },
  3: { accountName: 'Vacation3', amount: 176.73 },
};

type Handle = WorkflowHandle<typeof OpenInvestmentAccountWorkflow>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function state(handle: Handle): Promise<string> {
  return handle.query<string>('get_current_state');
}

/**
 * Prints every state the workflow reports until `done` returns true for one, and returns that state.
 * Polls the query, so very short-lived states may be skipped.
 */
async function followStates(
  handle: Handle,
  done: (current: string) => boolean,
  timeoutMs = 60_000,
  seen: { last?: string } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await state(handle);
    if (current !== seen.last) {
      console.log(`  state: ${current}`);
      seen.last = current;
    }
    if (done(current)) return current;
    if (Date.now() > deadline) {
      throw new Error(`${handle.workflowId} timed out in state '${current}'`);
    }
    await sleep(250);
  }
}

/** Follows the states until the workflow completes, then prints its result. */
async function finish(handle: Handle, seen: { last?: string }): Promise<void> {
  let completed = false;
  const result = handle.result().finally(() => {
    completed = true;
  });
  result.catch(() => undefined); // handled below; avoids an unhandled rejection while polling
  await followStates(handle, () => completed, 120_000, seen);
  const output: OpenInvestmentAccountOutput = await result;
  // The last state may be set right before completing; print it if the polling missed it
  await followStates(handle, () => true, 0, seen);
  console.log(`The result is ${JSON.stringify(output)}`);
  console.log(`The final state is '${await state(handle)}'`);
}

class Runner {
  constructor(
    private readonly client: Client,
    private readonly runId: string,
    private readonly taskQueue: string,
    private readonly amount: number | undefined,
  ) {}

  async start(scenario: number): Promise<Handle> {
    const { accountName, amount } = SCENARIOS[scenario];
    // Like the chat's IDs (OpenAccount-<chat>-<client>-<account>), with this run in place of the chat
    const workflowId = `OpenAccount-standalone-${this.runId}-${CLIENT_ID}-${accountName}`;
    const input: OpenInvestmentAccountInput = {
      client_id: CLIENT_ID,
      account_name: accountName,
      initial_amount: this.amount ?? amount,
      // No chat workflow to report the status to
      parent_workflow_id: '',
      promo_code: null,
    };
    const handle = await this.client.workflow.start<typeof OpenInvestmentAccountWorkflow>(
      'OpenInvestmentAccountWorkflow',
      { workflowId, taskQueue: this.taskQueue, args: [input] },
    );
    console.log(`Started ${workflowId} on task queue '${this.taskQueue}' (${accountName}, $${input.initial_amount})`);
    return handle;
  }

  async scenario1(): Promise<void> {
    const handle = await this.start(1);
    const seen = {};
    await followStates(handle, (s) => s === WAITING_KYC, undefined, seen);

    await handle.signal('verify_kyc');
    console.log('Sent verify_kyc');
    await followStates(handle, (s) => s === WAITING_COMPLIANCE_REVIEW, undefined, seen);

    await handle.signal('compliance_approved');
    console.log('Sent compliance_approved');
    await finish(handle, seen);
  }

  async scenario2(): Promise<void> {
    const handle = await this.start(2);
    const seen = {};

    // The update waits until the workflow has loaded the client
    const details = await handle.executeUpdate<WealthManagementClient | null, []>('get_client_details');
    console.log(`The client details are ${JSON.stringify(details)}`);

    const updated = await handle.executeUpdate<WealthManagementClient | null, [Partial<WealthManagementClient>]>(
      'update_client_details',
      { args: [{ last_name: 'Doenut' }] },
    );
    console.log(`The result of updating the client details is ${JSON.stringify(updated)}`);

    // Updating the details also completes KYC
    await followStates(handle, (s) => s === WAITING_COMPLIANCE_REVIEW, undefined, seen);

    await handle.signal('compliance_approved');
    console.log('Sent compliance_approved');
    await finish(handle, seen);
  }

  async scenario3(): Promise<void> {
    const handle = await this.start(3);
    const seen = {};
    await followStates(handle, (s) => s === WAITING_KYC, undefined, seen);
    await handle.signal('verify_kyc');
    console.log('Sent verify_kyc');
    await followStates(handle, (s) => s === WAITING_COMPLIANCE_REVIEW, undefined, seen);

    console.log('*****>>> Send the compliance approval for this workflow, in another terminal:');
    console.log(`*****>>>   src/temporal_supervisor/localsendcomplianceapproval.sh "${handle.workflowId}"`);
    await followStates(handle, (s) => s !== WAITING_COMPLIANCE_REVIEW, 24 * 60 * 60 * 1000, seen);
    console.log('Compliance approved');
    await finish(handle, seen);
  }

  run(scenario: number): Promise<void> {
    switch (scenario) {
      case 1:
        return this.scenario1();
      case 2:
        return this.scenario2();
      default:
        return this.scenario3();
    }
  }
}

const USAGE = `Usage: npm run open-account.scenarios -- [--scenario N ...] [--amount X]
  --scenario N  Run only this scenario (1, 2 or 3; repeatable). Default: all three.
  --amount X    Initial deposit for every scenario run, e.g. 300000 for client 123 to see the saga roll back.`;

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(USAGE);
  process.exit(message ? 1 : 0);
}

function parseArgs(argv: string[]): { scenarios: number[]; amount?: number } {
  const scenarios: number[] = [];
  let amount: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--help' || arg === '-h') usage();
    if (arg === '--scenario') {
      const n = Number(value);
      if (!(n in SCENARIOS)) usage(`Invalid scenario: ${value}`);
      if (!scenarios.includes(n)) scenarios.push(n);
      i++;
    } else if (arg === '--amount') {
      amount = Number(value);
      if (!(amount > 0)) usage(`Invalid amount: ${value}`);
      i++;
    } else {
      usage(`Unknown argument: ${arg}`);
    }
  }
  return { scenarios: scenarios.length ? scenarios : Object.keys(SCENARIOS).map(Number), amount };
}

async function main(): Promise<void> {
  const { scenarios, amount } = parseArgs(process.argv.slice(2));
  const helper = new ClientHelper();
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT || helper.taskQueue;
  const { connection, client } = await helper.connectClient();
  try {
    const runner = new Runner(client, randomUUID().slice(0, 8), taskQueue, amount);
    for (const scenario of scenarios) {
      console.log(`\n=== Scenario ${scenario} ===`);
      await runner.run(scenario);
    }
  } finally {
    await connection.close();
  }
}

main()
  // Exit explicitly: with the claim check on, the data converter keeps a Redis connection open
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
