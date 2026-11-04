import * as fs from 'fs';
import * as path from 'path';

const FUNDING_FILE = path.join(__dirname, '../../data/funding-accounts.json');

export interface FundingAccount {
  name: string;
  balance: number;
}

export interface Transfer {
  client_id: string;
  amount: number;
  balance_after: number;
}

interface FundingData {
  accounts: Record<string, FundingAccount>;
  transfers: Record<string, Transfer>;
}

export class InsufficientFundsError extends Error {}

/**
 * The client's linked external bank account, used to fund new investment accounts.
 *
 * Every movement of money carries a caller-supplied transfer ID and is recorded
 * in a ledger, so applying the same transfer twice (e.g. when an activity is
 * retried after it already succeeded) only moves the money once.
 */
export class FundingManager {
  constructor(private readonly filePath = FUNDING_FILE) {}

  private loadData(): FundingData {
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    return { accounts: parsed.accounts ?? {}, transfers: parsed.transfers ?? {} };
  }

  private saveData(data: FundingData): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  getAccount(clientId: string): FundingAccount {
    const account = this.loadData().accounts[clientId];
    if (!account) throw new Error(`No linked funding account for client ${clientId}`);
    return account;
  }

  debit(clientId: string, amount: number, transferId: string): Transfer {
    const data = this.loadData();
    const existing = data.transfers[transferId];
    if (existing) return existing;
    const account = this.accountIn(data, clientId);
    if (account.balance < amount) {
      throw new InsufficientFundsError(
        `${account.name} has ${formatUsd(account.balance)}, which is not enough to transfer ${formatUsd(amount)}`,
      );
    }
    return this.apply(data, clientId, -amount, transferId);
  }

  credit(clientId: string, amount: number, transferId: string): Transfer {
    const data = this.loadData();
    const existing = data.transfers[transferId];
    if (existing) return existing;
    return this.apply(data, clientId, amount, transferId);
  }

  private accountIn(data: FundingData, clientId: string): FundingAccount {
    const account = data.accounts[clientId];
    if (!account) throw new Error(`No linked funding account for client ${clientId}`);
    return account;
  }

  private apply(data: FundingData, clientId: string, delta: number, transferId: string): Transfer {
    const account = this.accountIn(data, clientId);
    account.balance = Math.round((account.balance + delta) * 100) / 100;
    const transfer: Transfer = { client_id: clientId, amount: delta, balance_after: account.balance };
    data.transfers[transferId] = transfer;
    this.saveData(data);
    return transfer;
  }
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
