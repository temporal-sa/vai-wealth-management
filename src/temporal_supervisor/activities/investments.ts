import { ApplicationFailure } from '@temporalio/common';
import { InvestmentManager, InvestmentAccount } from '../../common/investment-manager';
import { ChaosFlag } from '../../common/chaos-manager';
import { formatUsd } from '../../common/funding-manager';
import { coreBankingApi, isEnabled, maybeSlowDown } from '../chaos';

const mgr = new InvestmentManager();

export const MIN_INITIAL_DEPOSIT = 100;
export const MAX_INITIAL_DEPOSIT = 1_000_000;
export const WELCOME_BONUS_PROMO_CODE = 'WELCOME-BONUS';

export async function listInvestments(clientId: string): Promise<InvestmentAccount[]> {
  await coreBankingApi();
  return mgr.listInvestmentAccounts(clientId);
}

export async function openInvestment(
  clientId: string,
  name: string,
  balance: number,
): Promise<InvestmentAccount> {
  await coreBankingApi();
  await maybeSlowDown();
  const account = mgr.addInvestmentAccount(clientId, name, balance);
  if (!account) {
    throw ApplicationFailure.nonRetryable(`Invalid opening balance ${formatUsd(balance)}`, 'InvalidBalance');
  }
  return account;
}

export async function closeInvestment(
  clientId: string,
  investmentId: string,
): Promise<boolean> {
  await coreBankingApi();
  await maybeSlowDown();
  return mgr.deleteInvestmentAccount(clientId, investmentId);
}

/** Business rules for a new account. Breaking one is non-retryable: the same request would fail again. */
export async function validateNewAccount(clientId: string, accountName: string, initialAmount: number): Promise<void> {
  const normalized = accountName.trim().toLowerCase();
  if (mgr.listInvestmentAccounts(clientId).some((a) => a.name.trim().toLowerCase() === normalized)) {
    throw ApplicationFailure.nonRetryable(`An account named "${accountName}" already exists`, 'DuplicateAccountName');
  }
  if (initialAmount > MAX_INITIAL_DEPOSIT) {
    throw ApplicationFailure.nonRetryable(
      `Initial deposits over ${formatUsd(MAX_INITIAL_DEPOSIT)} cannot be opened online and must be arranged with a wealth advisor`,
      'DepositLimitExceeded',
    );
  }
  if (initialAmount < MIN_INITIAL_DEPOSIT) {
    throw ApplicationFailure.nonRetryable(
      `The minimum initial deposit is ${formatUsd(MIN_INITIAL_DEPOSIT)}`,
      'DepositTooSmall',
    );
  }
}

/**
 * The promotion, if any, for a new account. The "Bug in workflow code" chaos flag turns on a
 * promotion whose code path in the workflow has a bug. The flag is read here, not in the workflow,
 * because workflow code must be deterministic; the result is recorded in the workflow's history.
 */
export async function findPromotion(_clientId: string): Promise<string | null> {
  return (await isEnabled(ChaosFlag.WORKFLOW_BUG)) ? WELCOME_BONUS_PROMO_CODE : null;
}
