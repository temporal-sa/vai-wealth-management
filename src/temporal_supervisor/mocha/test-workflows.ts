// Workflows for the failure-scenario tests: the real Open Account workflow, plus a stand-in
// for the supervisor that records the status signals the Open Account workflow sends it.
import { condition, defineQuery, defineSignal, setHandler } from '@temporalio/workflow';
import type { UpdateStatusInput } from '../shared';
import { UPDATE_STATUS_SIGNAL } from '../shared';

export { OpenInvestmentAccountWorkflow } from '../workflows/open-account';

export const getStatusesQuery = defineQuery<string[]>('get_statuses');

export async function TestParentWorkflow(): Promise<string[]> {
  const statuses: string[] = [];
  setHandler(defineSignal<[UpdateStatusInput]>(UPDATE_STATUS_SIGNAL), ({ status }) => {
    statuses.push(status);
  });
  setHandler(getStatusesQuery, () => statuses);
  await condition(() => statuses.some((s) => s.endsWith('successfully opened.') || s.endsWith('rolled back.')));
  return statuses;
}
