import { Connection, Client } from '@temporalio/client';
import { WealthManagementClient } from '../shared';

function getTemporalClient(): Promise<Client> {
  return Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233' }).then(
    (conn) => new Client({ connection: conn }),
  );
}

/**
 * Queries the OpenInvestmentAccountWorkflow child workflow for the current client details.
 */
export async function getCurrentClientInfo(childWorkflowId: string): Promise<WealthManagementClient | null> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(childWorkflowId);
  return handle.query<WealthManagementClient | null>('get_client_details');
}

/**
 * Updates the client details in the child workflow via update.
 */
export async function updateClientDetails(
  childWorkflowId: string,
  fields: Partial<WealthManagementClient>,
): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(childWorkflowId);
  await handle.executeUpdate('update_client_details', { args: [fields] });
}

/**
 * Queries the OpenInvestmentAccountWorkflow child workflow for its current state.
 */
export async function getAccountStatus(childWorkflowId: string): Promise<string> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(childWorkflowId);
  return handle.query<string>('get_current_state');
}

/**
 * The task queue for the OpenInvestmentAccountWorkflow child workflow, or null to run it on this
 * worker's task queue. Set TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT to run it on another worker, such as
 * the Java one in /java. Workflow code can't read the environment, so it asks this activity.
 */
export async function getOpenAccountTaskQueue(): Promise<string | null> {
  return process.env.TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT || null;
}
