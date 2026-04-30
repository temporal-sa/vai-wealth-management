import {
  defineSignal,
  defineQuery,
  defineUpdate,
  setHandler,
  condition,
  proxyActivities,
  workflowInfo,
  getExternalWorkflowHandle,
  log,
} from '@temporalio/workflow';
import type { OpenInvestmentAccountInput, WealthManagementClient, UpdateStatusInput } from '../shared';
import { UPDATE_STATUS_SIGNAL } from '../shared';
import type * as clientActivities from '../activities/clients';
import type * as investmentActivities from '../activities/investments';

const { getClient } = proxyActivities<typeof clientActivities>({
  startToCloseTimeout: '30s',
});
const { openInvestment } = proxyActivities<typeof investmentActivities>({
  startToCloseTimeout: '30s',
});

// ---------------------------------------------------------------------------
// Signals / Queries / Updates
// ---------------------------------------------------------------------------

const verifyKycSignal = defineSignal('verify_kyc');
const complianceApprovedSignal = defineSignal('compliance_approved');
const getCurrentStateQuery = defineQuery<string>('get_current_state');
const getClientDetailsQuery = defineQuery<WealthManagementClient | null>('get_client_details');
const updateClientDetailsUpdate = defineUpdate<void, [Partial<WealthManagementClient>]>('update_client_details');

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export async function OpenInvestmentAccountWorkflow(
  input: OpenInvestmentAccountInput,
): Promise<void> {
  let state = 'Initializing';
  let kycApproved = false;
  let complianceApproved = false;
  let clientDetails: WealthManagementClient | null = null;

  const { client_id, account_name, initial_amount, parent_workflow_id } = input;

  async function signalParent(status: string) {
    const update: UpdateStatusInput = { status };
    const parentHandle = getExternalWorkflowHandle(parent_workflow_id);
    await parentHandle.signal(UPDATE_STATUS_SIGNAL, update);
  }

  // Query handlers
  setHandler(getCurrentStateQuery, () => state);
  setHandler(getClientDetailsQuery, () => clientDetails);

  // Signal handlers
  setHandler(verifyKycSignal, () => { kycApproved = true; });
  setHandler(complianceApprovedSignal, () => { complianceApproved = true; });

  // Update handler — allows agent to update client details during KYC
  setHandler(updateClientDetailsUpdate, (fields: Partial<WealthManagementClient>) => {
    if (clientDetails) {
      clientDetails = { ...clientDetails, ...fields };
    }
  });

  // Step 1: Load client details
  log.info('OpenInvestmentAccountWorkflow started', { client_id, account_name, initial_amount });
  clientDetails = await getClient(client_id);
  state = 'Waiting KYC';
  log.info('State: Waiting KYC', { account_name });
  await signalParent(`Account "${account_name}" is waiting for KYC verification.`);

  // Step 2: Wait for KYC approval
  await condition(() => kycApproved);
  state = 'Waiting Compliance Review';
  log.info('State: Waiting Compliance Review', { account_name });
  await signalParent(`KYC approved. Account "${account_name}" is waiting for compliance review.`);

  // Step 3: Wait for compliance approval
  await condition(() => complianceApproved);
  state = 'Complete';
  log.info('State: Complete', { account_name });

  // Step 4: Create the investment account
  await openInvestment(client_id, account_name, initial_amount);
  log.info('Investment account opened successfully', { account_name });
  await signalParent(`Account "${account_name}" has been successfully opened.`);
}
