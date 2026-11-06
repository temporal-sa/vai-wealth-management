import { startChild } from '@temporalio/workflow';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common';
import type { OpenInvestmentAccountInput } from '../shared';

/**
 * The Open Account workflow ID for a chat, client and account name, e.g.
 * "OpenAccount-<chat workflow ID>-123-College Fund" (the account name as given, like the reference
 * implementation). Temporal allows only one running workflow per ID, so a repeated tool call in the
 * same chat can't open the same account twice. The chat's workflow ID keeps two chats for the same
 * client apart, so each one gets its own opening and status updates. Once that workflow closes
 * (opened or rolled back), the ID can be used again.
 */
export function openAccountWorkflowId(parentWorkflowId: string, clientId: string, accountName: string): string {
  return `OpenAccount-${parentWorkflowId}-${clientId}-${accountName}`;
}

/**
 * Starts the Open Account child workflow, or finds the one already opening this account.
 * Without a task queue the child runs on the caller's; with one it can run in Java.
 */
export async function startOpenAccount(
  input: OpenInvestmentAccountInput,
  taskQueue?: string,
): Promise<{ childWorkflowId: string; alreadyRunning: boolean }> {
  const childWorkflowId = openAccountWorkflowId(input.parent_workflow_id, input.client_id, input.account_name);
  try {
    await startChild('OpenInvestmentAccountWorkflow', {
      workflowId: childWorkflowId,
      taskQueue,
      args: [input],
    });
    return { childWorkflowId, alreadyRunning: false };
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      return { childWorkflowId, alreadyRunning: true };
    }
    throw err;
  }
}
