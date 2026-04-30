import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const BENEFICIARIES_FILE = path.join(__dirname, '../../data/beneficiaries.json');

export interface Beneficiary {
  beneficiary_id: string;
  first_name: string;
  last_name: string;
  relationship: string;
}

type BeneficiariesData = Record<string, Beneficiary[]>;

export class BeneficiariesManager {
  private filePath: string;
  private data: BeneficiariesData;

  constructor(filePath = BENEFICIARIES_FILE) {
    this.filePath = filePath;
    this.data = this.loadData();
  }

  private loadData(): BeneficiariesData {
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

  listBeneficiaries(clientId: string): Beneficiary[] {
    return this.data[clientId] ?? [];
  }

  addBeneficiary(
    clientId: string,
    firstName: string,
    lastName: string,
    relationship: string,
  ): Beneficiary {
    if (!this.data[clientId]) this.data[clientId] = [];

    const existingIds = new Set(this.data[clientId].map((b) => b.beneficiary_id));
    let newId = `b-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    while (existingIds.has(newId)) {
      newId = `b-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    }

    const beneficiary: Beneficiary = {
      beneficiary_id: newId,
      first_name: firstName,
      last_name: lastName,
      relationship,
    };
    this.data[clientId].push(beneficiary);
    this.saveData();
    return beneficiary;
  }

  deleteBeneficiary(clientId: string, beneficiaryId: string): boolean {
    if (!this.data[clientId]) return false;
    const before = this.data[clientId].length;
    this.data[clientId] = this.data[clientId].filter(
      (b) => b.beneficiary_id !== beneficiaryId,
    );
    if (this.data[clientId].length < before) {
      if (this.data[clientId].length === 0) delete this.data[clientId];
      this.saveData();
      return true;
    }
    return false;
  }
}
