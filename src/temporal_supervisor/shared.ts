export const TASK_QUEUE_NAME = 'VAISupervisor';

// Model calls run on their own task queue, so the server can rate limit them across all workers.
// This is the default name; TEMPORAL_TASK_QUEUE_LLM overrides it (see ClientHelper.taskQueueLLM).
export function llmTaskQueue(taskQueue: string): string {
  return `${taskQueue}-llm`;
}

// Signal names — must match the Python temporal_supervisor signal definitions exactly
export const PROCESS_USER_MESSAGE_SIGNAL = 'process_user_message';
export const END_WORKFLOW_SIGNAL = 'end_workflow';
export const UPDATE_ACCOUNT_OPENING_STATE_SIGNAL = 'update_account_opening_state';

export interface ProcessUserMessageInput {
  user_input: string;
}

/**
 * Payload of the update_account_opening_state signal, which an Open Account workflow sends its
 * parent on every state change. The supervisor keeps the latest state per workflow ID (read by the
 * get_account_opening_status tool) and shows accountStatusText in the UI.
 */
export interface UpdateAccountOpeningStateInput {
  account_name: string;
  state: string;
  // The Open Account workflow that reported the state. Optional so that senders that don't set it
  // keep working.
  workflow_id?: string | null;
}

// The status text shown in the UI when an account opening changes state
export function accountStatusText(accountName: string, state: string): string {
  return `New ${accountName} account status changed: ${state}`;
}

export interface ChatInteraction {
  user_prompt: string;
  text_response: string;
  json_response?: string;
  agent_trace?: string;
}

export interface StatusUpdate {
  status: string;
}

export interface OpenInvestmentAccountInput {
  client_id: string;
  account_name: string;
  initial_amount: number;
  // The chat (supervisor) workflow that receives the status updates. Empty when the workflow is
  // started on its own, as run_open_account_workflow.ts does; the status updates are then skipped.
  parent_workflow_id: string;
  // Set when a promotion is running for the new account (e.g. "WELCOME-BONUS")
  promo_code?: string | null;
}

export interface OpenInvestmentAccountOutput {
  account_created: boolean;
  message: string;
}

export interface WealthManagementClient {
  client_id: string;
  first_name: string;
  last_name: string;
  address: string;
  phone: string;
  email: string;
  marital_status: string;
}
