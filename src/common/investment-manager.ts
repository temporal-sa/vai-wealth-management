import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const INVESTMENTS_FILE = path.join(__dirname, '../../data/investments.json');

export interface InvestmentAccount {
  investment_id: string;
  name: string;
  balance: number;
}

type InvestmentsData = Record<string, InvestmentAccount[]>;

export class InvestmentManager {
  private filePath: string;
  private data: InvestmentsData;

  constructor(filePath = INVESTMENTS_FILE) {
    this.filePath = filePath;
    this.data = this.loadData();
  }

  private loadData(): InvestmentsData {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
      } catch {
        // fall through to empty
      }
    }
    return {};
  }

  private saveData(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  listInvestmentAccounts(clientId: string): InvestmentAccount[] {
    this.data = this.loadData();
    return this.data[clientId] ?? [];
  }

  addInvestmentAccount(
    clientId: string,
    name: string,
    balance: number,
  ): InvestmentAccount | null {
    if (balance < 0) return null;
    if (!this.data[clientId]) this.data[clientId] = [];

    const existingIds = new Set(this.data[clientId].map((a) => a.investment_id));
    let newId = `i-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    while (existingIds.has(newId)) {
      newId = `i-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    }

    const account: InvestmentAccount = { investment_id: newId, name, balance };
    this.data[clientId].push(account);
    this.saveData();
    return account;
  }

  deleteInvestmentAccount(clientId: string, investmentId: string): boolean {
    if (!this.data[clientId]) return false;
    const before = this.data[clientId].length;
    this.data[clientId] = this.data[clientId].filter(
      (a) => a.investment_id !== investmentId,
    );
    if (this.data[clientId].length < before) {
      if (this.data[clientId].length === 0) delete this.data[clientId];
      this.saveData();
      return true;
    }
    return false;
  }
}
