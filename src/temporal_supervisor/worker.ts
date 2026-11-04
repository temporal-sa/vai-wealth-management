import { NativeConnection, Worker, Runtime, DefaultLogger } from '@temporalio/worker';
import type { LogEntry } from '@temporalio/worker';
import { AiSdkPlugin } from '@temporalio/ai-sdk';
import { google } from '@ai-sdk/google';
import * as activities from './activities/activities';
import { ClientHelper } from '../common/client-helper';
import { buildDataConverter } from '../common/data-converter';
import { chaosAwareProvider } from './chaos-model';

// ---------------------------------------------------------------------------
// Concise logger — strip SDK-internal metadata, one line per entry
// ---------------------------------------------------------------------------

const SKIP_KEYS = new Set(['sdkComponent', 'taskQueue', 'taskToken', 'runId', 'namespace', 'workflowType', 'workflowExists']);

Runtime.install({
  logger: new DefaultLogger('INFO', ({ level, message, meta }: LogEntry) => {
    const extras = Object.entries(meta ?? {})
      .filter(([k]) => !SKIP_KEYS.has(k))
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    console.error(`${ts} [${level.padEnd(5)}] ${message}${extras ? '  ' + extras : ''}`);
  }),
});

function logClaimCheckStatus(): void {
  if (process.env.USE_CLAIM_CHECK === 'true') {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = process.env.REDIS_PORT ?? '6379';
    console.error(`Claim check enabled (redis at ${host}:${port})`);
  } else {
    console.error('Claim check disabled');
  }
}

function logOpenAccountTaskQueue(taskQueue: string): void {
  const openAccountQueue = process.env.TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT;
  if (openAccountQueue) {
    console.error(`Open Account workflow runs on task queue ${openAccountQueue}; remember to start the Java worker`);
  } else {
    console.error(`Open Account workflow runs on this worker (task queue ${taskQueue})`);
  }
}

// Optional cap on model calls per second across all workers, enforced by the Temporal server
function llmMaxCallsPerSecond(): number | undefined {
  const value = Number(process.env.LLM_MAX_CALLS_PER_SECOND);
  return value > 0 ? value : undefined;
}

async function run() {
  logClaimCheckStatus();
  const helper = new ClientHelper();
  logOpenAccountTaskQueue(helper.taskQueue);
  const connection = await NativeConnection.connect(helper.nativeConnectionOptions);
  try {
    const plugin = new AiSdkPlugin({ modelProvider: chaosAwareProvider(google) });
    const worker = await Worker.create({
      connection,
      namespace: helper.namespace,
      taskQueue: helper.taskQueue,
      workflowsPath: require.resolve('./workflows/index'),
      activities,
      dataConverter: buildDataConverter(),
      plugins: [plugin],
      // @temporalio/ai-sdk's barrel re-exports activity-side code alongside
      // the workflow-safe temporalProvider; the bundler stubs them. Crypto is
      // pulled in transitively by the same path. None are reachable from
      // workflow code paths at runtime.
      bundlerOptions: {
        ignoreModules: ['@temporalio/activity', '@temporalio/client', 'crypto'],
      },
    });

    // Model calls run on their own task queue, so the server can rate limit them.
    // The plugin registers the model activities on every worker it is given.
    const llmQueue = helper.taskQueueLLM;
    const maxCallsPerSecond = llmMaxCallsPerSecond();
    console.error(`Model calls run on task queue ${llmQueue}` +
      (maxCallsPerSecond ? `, limited to ${maxCallsPerSecond} per second` : ''));
    const llmWorker = await Worker.create({
      connection,
      namespace: helper.namespace,
      taskQueue: llmQueue,
      dataConverter: buildDataConverter(),
      plugins: [plugin],
      maxTaskQueueActivitiesPerSecond: maxCallsPerSecond,
    });

    await Promise.all([worker.run(), llmWorker.run()]);
  } finally {
    // Close the connection once the worker has stopped
    await connection.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
