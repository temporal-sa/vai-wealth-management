import { loadClientConnectConfig } from '@temporalio/envconfig';
import { Connection, Client } from '@temporalio/client';
import type { NativeConnectionOptions } from '@temporalio/worker';
import { TASK_QUEUE_NAME, llmTaskQueue } from '../temporal_supervisor/shared';
import { buildDataConverter } from './data-converter';

const DEFAULT_ADDRESS = 'localhost:7233';
const DEFAULT_NAMESPACE = 'default';

export class ClientHelper {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
  // Task queue for the model (LLM) calls, so they can be rate limited separately from the tools
  readonly taskQueueLLM: string;
  readonly nativeConnectionOptions: NativeConnectionOptions;

  constructor() {
    const config = loadClientConnectConfig();
    this.address = config.connectionOptions.address ?? DEFAULT_ADDRESS;
    this.namespace = config.namespace ?? DEFAULT_NAMESPACE;
    this.taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? TASK_QUEUE_NAME;
    this.taskQueueLLM = process.env.TEMPORAL_TASK_QUEUE_LLM || llmTaskQueue(this.taskQueue);
    this.nativeConnectionOptions = { ...config.connectionOptions, address: this.address };
  }

  async connectClient(): Promise<{ connection: Connection; client: Client }> {
    const { address, tls, metadata, apiKey } = this.nativeConnectionOptions;
    const connection = await Connection.connect({ address, tls, metadata, apiKey });
    const client = new Client({ connection, namespace: this.namespace, dataConverter: buildDataConverter() });
    return { connection, client };
  }
}
let sharedClient: Promise<Client> | undefined;

/**
 * A client for code that runs inside the worker process, such as activities. It uses the same
 * connection settings (namespace, TLS, API key) and data converter (claim check) as the worker,
 * and is created once per process. A failed connection attempt is retried on the next call.
 */
export function getSharedClient(): Promise<Client> {
  if (!sharedClient) {
    sharedClient = new ClientHelper().connectClient().then(({ client }) => client);
    sharedClient.catch(() => {
      sharedClient = undefined;
    });
  }
  return sharedClient;
}
