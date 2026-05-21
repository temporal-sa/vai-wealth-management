import { NativeConnection, Worker, Runtime, DefaultLogger } from '@temporalio/worker';
import type { LogEntry } from '@temporalio/worker';
import * as activities from './activities/activities';
import { ClientHelper } from '../common/client-helper';
import { buildDataConverter } from '../common/data-converter';

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

async function run() {
  logClaimCheckStatus();
  const helper = new ClientHelper();
  const connection = await NativeConnection.connect(helper.nativeConnectionOptions);
  try {
    const worker = await Worker.create({
      connection,
      namespace: helper.namespace,
      taskQueue: helper.taskQueue,
      workflowsPath: require.resolve('./workflows/index'),
      activities,
      dataConverter: buildDataConverter(),
    });

    await worker.run();
  } finally {
    // Close the connection once the worker has stopped
    await connection.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
