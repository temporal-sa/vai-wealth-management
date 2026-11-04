import { ApplicationFailure } from '@temporalio/common';
import { FundingManager, InsufficientFundsError, Transfer } from '../../common/funding-manager';
import { maybeSlowDown } from '../chaos';

// Moves money to and from the client's linked bank account. Each call takes a transfer ID
// that is stable across retries, so a retried activity never moves the money twice.

const mgr = new FundingManager();

/** Transfer the initial deposit out of the client's linked bank account. */
export async function debitLinkedAccount(clientId: string, amount: number, transferId: string): Promise<Transfer> {
  await maybeSlowDown();
  try {
    return mgr.debit(clientId, amount, transferId);
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      // A business-rule failure: retrying will not make the money appear
      throw ApplicationFailure.nonRetryable(err.message, 'InsufficientFunds');
    }
    throw err;
  }
}

/** Refund money to the client's linked bank account (saga compensation). */
export async function creditLinkedAccount(clientId: string, amount: number, transferId: string): Promise<Transfer> {
  await maybeSlowDown();
  return mgr.credit(clientId, amount, transferId);
}
