// Workflows for the failure-scenario tests: the real Open Account workflow, plus a stand-in
// for the supervisor that records the status signals the Open Account workflow sends it.
import { condition, defineQuery, defineSignal, setHandler } from '@temporalio/workflow';
import type { OpenInvestmentAccountInput, UpdateStatusInput } from '../shared';
import { UPDATE_STATUS_SIGNAL, statusText } from '../shared';
import { startOpenAccount } from '../workflows/start-open-account';

export { OpenInvestmentAccountWorkflow } from '../workflows/open-account';

export const getStatusesQuery = defineQuery<string[]>('get_statuses');

// Records the status text the supervisor would show, and finishes once the opening has finished
export async function TestParentWorkflow(): Promise<string[]> {
  const statuses: string[] = [];
  let finished = false;
  setHandler(defineSignal<[UpdateStatusInput]>(UPDATE_STATUS_SIGNAL), (update) => {
    statuses.push(statusText(update));
    finished ||= update.state === 'Complete' || !!update.state?.startsWith('Rolled back');
  });
  setHandler(getStatusesQuery, () => statuses);
  await condition(() => finished);
  return statuses;
}

// Starts the same Open Account workflow `times` times, as a model repeating its tool call would.
// The children are terminated when this workflow returns.
export async function StartOpenAccountTwiceWorkflow(
  input: OpenInvestmentAccountInput,
  times: number,
): Promise<{ childWorkflowId: string; alreadyRunning: boolean }[]> {
  const results = [];
  for (let i = 0; i < times; i++) {
    results.push(await startOpenAccount(input));
  }
  return results;
}
