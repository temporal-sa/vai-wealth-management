export const TASK_QUEUE_NAME = 'VAISupervisor';

// Signal names — must match the Python temporal_supervisor signal definitions exactly
export const PROCESS_USER_MESSAGE_SIGNAL = 'process_user_message';
export const END_WORKFLOW_SIGNAL = 'end_workflow';
export const UPDATE_STATUS_SIGNAL = 'update_status';

export interface ProcessUserMessageInput {
  user_input: string;
}

export interface UpdateStatusInput {
  status: string;
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
  parent_workflow_id: string;
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
