// Workflows for the failure-scenario tests: the real Open Account workflow, plus a stand-in
// for the supervisor that records the status signals the Open Account workflow sends it.
import { condition, defineQuery, defineSignal, setHandler } from '@temporalio/workflow';
import type { OpenInvestmentAccountInput, UpdateAccountOpeningStateInput } from '../shared';
import { UPDATE_ACCOUNT_OPENING_STATE_SIGNAL, accountStatusText } from '../shared';
import { startOpenAccount } from '../workflows/start-open-account';

export { OpenInvestmentAccountWorkflow } from '../workflows/open-account';

export const getStatusesQuery = defineQuery<string[]>('get_statuses');

// Records the status text the supervisor would show, and finishes once the opening has finished
export async function TestParentWorkflow(): Promise<string[]> {
  const statuses: string[] = [];
  let finished = false;
  setHandler(defineSignal<[UpdateAccountOpeningStateInput]>(UPDATE_ACCOUNT_OPENING_STATE_SIGNAL), (update) => {
    statuses.push(accountStatusText(update.account_name, update.state));
    finished ||= update.state === 'Complete' || update.state.startsWith('Rolled back');
  });
  setHandler(getStatusesQuery, () => statuses);
  await condition(() => finished);
  return statuses;
}

// Starts an Open Account workflow for the same account `times` times, as a customer asking to open
// it again would: each one is a new opening with the next number. The children are terminated when
// this workflow returns.
export async function StartOpenAccountRepeatedlyWorkflow(
  input: OpenInvestmentAccountInput,
  times: number,
): Promise<string[]> {
  const childWorkflowIds = [];
  for (let openingNumber = 1; openingNumber <= times; openingNumber++) {
    childWorkflowIds.push(await startOpenAccount(input, openingNumber));
  }
  return childWorkflowIds;
}
