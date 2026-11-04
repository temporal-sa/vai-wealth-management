import { ClientHelper, getSharedClient } from '../../common/client-helper';
import { WealthManagementClient } from '../shared';

/**
 * The current client details from the OpenInvestmentAccountWorkflow child workflow. It is an update,
 * so it waits until the workflow has loaded them.
 */
export async function getCurrentClientInfo(childWorkflowId: string): Promise<WealthManagementClient | null> {
  const client = await getSharedClient();
  const handle = client.workflow.getHandle(childWorkflowId);
  return handle.executeUpdate<WealthManagementClient | null, []>('get_client_details');
}

/**
 * Saves corrected client details through the child workflow, which also approves KYC.
 * Returns the saved client record.
 */
export async function updateClientDetails(
  childWorkflowId: string,
  fields: Partial<WealthManagementClient>,
): Promise<WealthManagementClient | null> {
  const client = await getSharedClient();
  const handle = client.workflow.getHandle(childWorkflowId);
  return handle.executeUpdate<WealthManagementClient | null, [Partial<WealthManagementClient>]>(
    'update_client_details',
    { args: [fields] },
  );
}

/**
 * Queries the OpenInvestmentAccountWorkflow child workflow for its current state.
 */
export async function getAccountStatus(childWorkflowId: string): Promise<string> {
  const client = await getSharedClient();
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

/**
 * The task queue for model (LLM) calls: TEMPORAL_TASK_QUEUE_LLM, or "<TEMPORAL_TASK_QUEUE>-llm".
 * Workflow code can't read the environment, so it asks this activity.
 */
export async function getLlmTaskQueue(): Promise<string> {
  return new ClientHelper().taskQueueLLM;
}
