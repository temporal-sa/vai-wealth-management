import { startChild } from '@temporalio/workflow';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common';
import type { OpenInvestmentAccountInput } from '../shared';

/**
 * The Open Account workflow ID for a client and account name, e.g. "open-account-123-college-fund".
 * Temporal allows only one running workflow per ID, so a repeated tool call can't open the same
 * account twice. Once that workflow closes (opened or rolled back), the ID can be used again.
 */
export function openAccountWorkflowId(clientId: string, accountName: string): string {
  const slug = accountName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `open-account-${clientId}-${slug}`;
}

/**
 * Starts the Open Account child workflow, or finds the one already opening this account.
 * Without a task queue the child runs on the caller's; with one it can run in Java.
 */
export async function startOpenAccount(
  input: OpenInvestmentAccountInput,
  taskQueue?: string,
): Promise<{ childWorkflowId: string; alreadyRunning: boolean }> {
  const childWorkflowId = openAccountWorkflowId(input.client_id, input.account_name);
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
