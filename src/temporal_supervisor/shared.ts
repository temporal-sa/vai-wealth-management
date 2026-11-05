export const TASK_QUEUE_NAME = 'VAISupervisor';

// Model calls run on their own task queue, so the server can rate limit them across all workers.
// This is the default name; TEMPORAL_TASK_QUEUE_LLM overrides it (see ClientHelper.taskQueueLLM).
export function llmTaskQueue(taskQueue: string): string {
  return `${taskQueue}-llm`;
}

// Signal names — must match the Python temporal_supervisor signal definitions exactly
export const PROCESS_USER_MESSAGE_SIGNAL = 'process_user_message';
export const END_WORKFLOW_SIGNAL = 'end_workflow';
export const UPDATE_STATUS_SIGNAL = 'update_status';

export interface ProcessUserMessageInput {
  user_input: string;
}

/**
 * Payload of the update_status signal. An Open Account workflow reports each state change with
 * account_name, state and workflow_id; the supervisor turns that into the status text shown in the
 * UI (see accountStatusText). Other senders can pass ready-made text in status instead.
 */
export interface UpdateStatusInput {
  status?: string;
  account_name?: string;
  state?: string;
  workflow_id?: string;
}

// The status text shown in the UI when an account opening changes state
export function accountStatusText(accountName: string, state: string): string {
  return `New ${accountName} account status changed: ${state}`;
}

// The status text for an update_status signal
export function statusText(input: UpdateStatusInput): string {
  if (input.status !== undefined && input.status !== null) return input.status;
  return accountStatusText(input.account_name ?? '', input.state ?? '');
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
