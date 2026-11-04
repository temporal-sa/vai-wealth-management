import { ApplicationFailure } from '@temporalio/common';
import { ChaosFlag } from '../../common/chaos-manager';
import { injectFailure, maybeSlowDown } from '../chaos';

/** Register a new investment account with the third-party custodian that holds its assets. Returns its reference. */
export async function registerAccount(_clientId: string, investmentId: string, _amount: number): Promise<string> {
  await maybeSlowDown();
  await injectFailure(
    ChaosFlag.CUSTODIAN_REJECTS,
    ApplicationFailure.nonRetryable('The custodian rejected the account registration', 'CustodianRejected'),
  );
  return `CUST-${investmentId}`;
}
