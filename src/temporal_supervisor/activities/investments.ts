import { ApplicationFailure } from '@temporalio/common';
import { InvestmentManager, InvestmentAccount } from '../../common/investment-manager';
import { ChaosFlag } from '../../common/chaos-manager';
import { formatUsd } from '../../common/funding-manager';
import { coreBankingApi, isEnabled, maybeSlowDown } from '../chaos';

const mgr = new InvestmentManager();

export const MIN_INITIAL_DEPOSIT = 100;
export const MAX_INITIAL_DEPOSIT = 1_000_000;
export const WELCOME_BONUS_PROMO_CODE = 'WELCOME-BONUS';

export async function list_investments(clientId: string): Promise<InvestmentAccount[]> {
  await coreBankingApi();
  return mgr.listInvestmentAccounts(clientId);
}

/** The new account is one object, {client_id, name, balance}, as the reference port and the Java workflow send it. */
export async function open_investment(newAccount: {
  client_id: string;
  name: string;
  balance: number;
}): Promise<InvestmentAccount> {
  const { client_id: clientId, name, balance } = newAccount;
  await coreBankingApi();
  await maybeSlowDown();
  const account = mgr.addInvestmentAccount(clientId, name, balance);
  if (!account) {
    throw ApplicationFailure.nonRetryable(`Invalid opening balance ${formatUsd(balance)}`, 'InvalidBalance');
  }
  return account;
}

/**
 * Removes an investment account record: the saga compensation for open_investment. An account that
 * is already gone counts as removed, so a retried compensation succeeds.
 */
export async function remove_investment(clientId: string, investmentId: string): Promise<boolean> {
  await maybeSlowDown();
  await coreBankingApi();
  mgr.deleteInvestmentAccount(clientId, investmentId);
  return true;
}

export async function close_investment(
  clientId: string,
  investmentId: string,
): Promise<boolean> {
  await coreBankingApi();
  await maybeSlowDown();
  return mgr.deleteInvestmentAccount(clientId, investmentId);
}

/** Business rules for a new account. Breaking one is non-retryable: the same request would fail again. */
export async function validate_new_account(_clientId: string, _accountName: string, initialAmount: number): Promise<void> {
  if (initialAmount > MAX_INITIAL_DEPOSIT) {
    throw ApplicationFailure.nonRetryable(
      `Initial deposits over ${formatUsd(MAX_INITIAL_DEPOSIT)} cannot be opened online and must be arranged with a wealth advisor`,
      'DepositLimitExceeded',
    );
  }
  if (initialAmount < MIN_INITIAL_DEPOSIT) {
    throw ApplicationFailure.nonRetryable(
      `The minimum initial deposit is ${formatUsd(MIN_INITIAL_DEPOSIT)}`,
      'DepositBelowMinimum',
    );
  }
}

/**
 * The promotion, if any, for a new account. The "Bug in workflow code" chaos flag turns on a
 * promotion whose code path in the workflow has a bug. The flag is read here, not in the workflow,
 * because workflow code must be deterministic; the result is recorded in the workflow's history.
 */
export async function find_promotion(_clientId: string): Promise<string | null> {
  return (await isEnabled(ChaosFlag.WORKFLOW_BUG)) ? WELCOME_BONUS_PROMO_CODE : null;
}
