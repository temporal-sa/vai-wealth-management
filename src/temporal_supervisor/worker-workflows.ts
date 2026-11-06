/**
 * The workflows module (relative to this directory) for a worker on `taskQueue`. When
 * TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT names another task queue, the Open Account workflow runs there
 * (on the Java worker in /java), so the worker registers only the supervisor workflow; otherwise it
 * registers both.
 */
export function workflowsModule(taskQueue: string, openAccountQueue: string | undefined): string {
  return openAccountQueue && openAccountQueue !== taskQueue ? './workflows/supervisor-only' : './workflows/index';
}
