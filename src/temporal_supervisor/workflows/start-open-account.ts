import { startChild } from '@temporalio/workflow';
import type { OpenInvestmentAccountInput } from '../shared';

/**
 * The Open Account workflow ID for a chat, client, account name and opening number, e.g.
 * "OpenAccount-<chat workflow ID>-123-College Fund-2" (the account name as given, like the reference
 * implementation). The number counts the account openings started in the chat so far, this one
 * included (1, 2, 3, ...), so every request to open an account starts a new opening with its own
 * KYC, even when an earlier opening with the same name is still running or has finished. The chat's
 * workflow ID keeps two chats for the same client apart, so each one gets its own openings and status
 * updates.
 */
export function openAccountWorkflowId(
  parentWorkflowId: string,
  clientId: string,
  accountName: string,
  openingNumber: number,
): string {
  return `OpenAccount-${parentWorkflowId}-${clientId}-${accountName}-${openingNumber}`;
}

/**
 * Starts the Open Account child workflow for the given opening number and returns its workflow ID.
 * Without a task queue the child runs on the caller's; with one it can run in Java.
 */
export async function startOpenAccount(
  input: OpenInvestmentAccountInput,
  openingNumber: number,
  taskQueue?: string,
): Promise<string> {
  const childWorkflowId = openAccountWorkflowId(
    input.parent_workflow_id,
    input.client_id,
    input.account_name,
    openingNumber,
  );
  await startChild('OpenInvestmentAccountWorkflow', {
    workflowId: childWorkflowId,
    taskQueue,
    args: [input],
  });
  return childWorkflowId;
}
