import { loadClientConnectConfig } from '@temporalio/envconfig';
import { Connection, Client } from '@temporalio/client';
import type { NativeConnectionOptions } from '@temporalio/worker';
import { TASK_QUEUE_NAME } from '../temporal_supervisor/shared';

const DEFAULT_ADDRESS = 'localhost:7233';
const DEFAULT_NAMESPACE = 'default';

export class ClientHelper {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly nativeConnectionOptions: NativeConnectionOptions;

  constructor() {
    const config = loadClientConnectConfig();
    this.address = config.connectionOptions.address ?? DEFAULT_ADDRESS;
    this.namespace = config.namespace ?? DEFAULT_NAMESPACE;
    this.taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? TASK_QUEUE_NAME;
    this.nativeConnectionOptions = { ...config.connectionOptions, address: this.address };
  }

  async connectClient(): Promise<{ connection: Connection; client: Client }> {
    const { address, tls, metadata, apiKey } = this.nativeConnectionOptions;
    const connection = await Connection.connect({ address, tls, metadata, apiKey });
    const client = new Client({ connection, namespace: this.namespace });
    return { connection, client };
  }
}