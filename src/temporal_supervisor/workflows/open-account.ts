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
  ActivityFailure,
  ApplicationFailure,
} from '@temporalio/workflow';
import type {
  OpenInvestmentAccountInput,
  OpenInvestmentAccountOutput,
  WealthManagementClient,
  UpdateStatusInput,
} from '../shared';
import { UPDATE_STATUS_SIGNAL } from '../shared';
import { TOOL_RETRY_POLICY } from '../retry-policies';
import type * as clientActivities from '../activities/clients';
import type * as investmentActivities from '../activities/investments';
import type * as fundingActivities from '../activities/funding';
import type * as custodianActivities from '../activities/custodian';

// One attempt may take 30 seconds; an outage is retried for as long as it lasts
const activityOptions = { startToCloseTimeout: '30s', retry: TOOL_RETRY_POLICY } as const;
const { getClient, updateClient } = proxyActivities<typeof clientActivities>(activityOptions);
const { openInvestment, closeInvestment } = proxyActivities<typeof investmentActivities>(activityOptions);
const { debitLinkedAccount, creditLinkedAccount } = proxyActivities<typeof fundingActivities>(activityOptions);
const { registerAccount } = proxyActivities<typeof custodianActivities>(activityOptions);


interface Promotion {
  rate: number;
  maxBonus: number;
}

// ---------------------------------------------------------------------------
// Welcome-bonus promotion: a percentage of the initial deposit, up to a maximum.
// *** Bug-In-Workflow-Code ***
// Intentional bug for the "Bug in workflow code" demo: the promo code is "WELCOME-BONUS" (hyphen),
// but PROMOTIONS is keyed by "WELCOME_BONUS" (underscore), so the lookup in welcomeBonus returns
// undefined and reading its rate throws a TypeError.
// To fix it, uncomment the first line below and comment out the second. See README "Failure scenarios".
// ---------------------------------------------------------------------------

// const PROMOTIONS: Record<string, Promotion> = { 'WELCOME-BONUS': { rate: 0.01, maxBonus: 500 } };
const PROMOTIONS: Record<string, Promotion> = { WELCOME_BONUS: { rate: 0.01, maxBonus: 500 } };

function welcomeBonus(promoCode: string, initialAmount: number): number {
  const promotion = PROMOTIONS[promoCode];
  return Math.min(initialAmount * promotion.rate, promotion.maxBonus);
}

// ---------------------------------------------------------------------------
// Signals / Queries / Updates
// ---------------------------------------------------------------------------

const verifyKycSignal = defineSignal('verify_kyc');
const complianceApprovedSignal = defineSignal('compliance_approved');
const getCurrentStateQuery = defineQuery<string>('get_current_state');
// An update rather than a query, so a caller that asks right after starting the workflow waits
// until the client details have been loaded instead of getting null
const getClientDetailsUpdate = defineUpdate<WealthManagementClient | null>('get_client_details');
const updateClientDetailsUpdate = defineUpdate<WealthManagementClient | null, [Partial<WealthManagementClient>]>(
  'update_client_details',
);

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export async function OpenInvestmentAccountWorkflow(
  input: OpenInvestmentAccountInput,
): Promise<OpenInvestmentAccountOutput> {
  let state = 'Initializing';
  let initialized = false;
  let kycApproved = false;
  let complianceApproved = false;
  let clientDetails: WealthManagementClient | null = null;

  const { client_id, account_name, initial_amount, parent_workflow_id, promo_code } = input;

  // Every state change is visible to get_account_status and reported to the parent, which shows
  // it in the UI's status area. Signals are routed by workflow ID, so this reaches the parent
  // whichever task queue it runs on.
  async function setState(newState: string) {
    state = newState;
    log.info(`State: ${newState}`, { account_name });
    const update: UpdateStatusInput = { account_name, state: newState, workflow_id: workflowInfo().workflowId };
    await getExternalWorkflowHandle(parent_workflow_id).signal(UPDATE_STATUS_SIGNAL, update);
  }

  // Query handlers
  setHandler(getCurrentStateQuery, () => state);

  // Signal handlers
  setHandler(verifyKycSignal, () => { kycApproved = true; });
  setHandler(complianceApprovedSignal, () => { complianceApproved = true; });

  // Update handlers
  setHandler(getClientDetailsUpdate, async () => {
    await condition(() => initialized);
    return clientDetails;
  });
  // The customer corrected their details during KYC: save them, which also approves KYC
  setHandler(updateClientDetailsUpdate, async (fields: Partial<WealthManagementClient>) => {
    const result = await updateClient(client_id, fields);
    if (result) clientDetails = result;
    kycApproved = true;
    return result;
  });

  // Step 1: Load client details
  log.info('OpenInvestmentAccountWorkflow started', { client_id, account_name, initial_amount, promo_code });
  clientDetails = await getClient(client_id);
  initialized = true;
  await setState('Waiting KYC');

  // Step 2: Wait for KYC approval
  await condition(() => kycApproved);
  await setState('Waiting Compliance Review');

  // Step 3: Wait for compliance approval
  await condition(() => complianceApproved);
  await setState('Compliance review has been approved. Creating Investment Account');

  // Step 4: Create, fund and register the investment account
  const bonus = promo_code ? welcomeBonus(promo_code, initial_amount) : 0;
  // Idempotency key: stable across activity retries and worker restarts. It includes the run ID
  // because the workflow ID is reused when the customer opens an account with the same name again
  // in the same chat (e.g. after a rollback), and a reused key would return the earlier transfer
  // without moving any money.
  const transferId = `${workflowInfo().workflowId}-${workflowInfo().runId}-initial-deposit`;

  // Saga: each completed step registers how to undo it. If a later step fails with a
  // non-retryable error, the compensations run in reverse order. Transient failures never
  // get here: activities retry until they succeed.
  const compensations: Array<{ description: string; undo: () => Promise<unknown> }> = [];
  try {
    await setState('Creating the account record.');
    const account = await openInvestment(client_id, account_name, initial_amount + bonus);
    compensations.unshift({
      description: 'removing the account record',
      undo: () => closeInvestment(client_id, account.investment_id),
    });

    await setState(`Transferring ${formatUsd(initial_amount)} from the linked bank account.`);
    await debitLinkedAccount(client_id, initial_amount, transferId);
    compensations.unshift({
      description: `refunding ${formatUsd(initial_amount)} to the linked bank account`,
      undo: () => creditLinkedAccount(client_id, initial_amount, `${transferId}-refund`),
    });

    await setState('Registering the account with the custodian.');
    await registerAccount(client_id, account.investment_id, initial_amount);
  } catch (err) {
    if (!(err instanceof ActivityFailure)) throw err;
    const reason = failureReason(err);
    await setState(`Failed: ${reason}. Rolling back.`);
    for (const { description, undo } of compensations) {
      await setState(`Rolling back: ${description}.`);
      // Compensations are activities too, so they are retried until they succeed
      await undo();
    }
    await setState(`Rolled back. The account was not opened: ${reason}.`);
    return { account_created: false, message: `The account was not opened: ${reason}` };
  }

  log.info('Investment account opened successfully', { account_name });
  await setState('Complete');
  return { account_created: true, message: 'investment account created' };
}

// The business reason for a non-retryable activity failure, such as the custodian rejecting the account
function failureReason(err: ActivityFailure): string {
  return err.cause instanceof ApplicationFailure ? err.cause.message : (err.cause?.message ?? err.message);
}

// Locale-independent, so a replay formats amounts exactly as the original run did
function formatUsd(amount: number): string {
  const [whole, cents] = amount.toFixed(2).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}
