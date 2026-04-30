import * as fs from 'fs';
import * as path from 'path';
import { WealthManagementClient } from '../temporal_supervisor/shared';

const CLIENTS_FILE = path.join(__dirname, '../../data/clients.json');

type ClientsData = Record<string, WealthManagementClient>;

export class ClientsManager {
  private filePath: string;
  private data: ClientsData;

  constructor(filePath = CLIENTS_FILE) {
    this.filePath = filePath;
    this.data = this.loadData();
  }

  private loadData(): ClientsData {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
      } catch {
        // fall through
      }
    }
    return {};
  }

  private saveData(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  getClient(clientId: string): WealthManagementClient | null {
    return this.data[clientId] ?? null;
  }

  addClient(client: WealthManagementClient): WealthManagementClient {
    this.data[client.client_id] = client;
    this.saveData();
    return client;
  }

  updateClient(clientId: string, fields: Partial<WealthManagementClient>): WealthManagementClient | null {
    if (!this.data[clientId]) return null;
    this.data[clientId] = { ...this.data[clientId], ...fields };
    this.saveData();
    return this.data[clientId];
  }
}
