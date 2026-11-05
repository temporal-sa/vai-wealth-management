// Workflows for the KYC guard test: the real supervisor workflow, plus a stand-in for an Open
// Account workflow that records whether KYC was approved.
import { condition, defineQuery, defineSignal, setHandler } from '@temporalio/workflow';

export { WealthManagementWorkflow } from '../workflows/wealth-management';

export const kycApprovedQuery = defineQuery<boolean>('kyc_approved');

export async function KycRecorderWorkflow(): Promise<void> {
  let approved = false;
  setHandler(defineSignal('verify_kyc'), () => {
    approved = true;
  });
  setHandler(kycApprovedQuery, () => approved);
  await condition(() => false);
}
