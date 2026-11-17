import { ClientsManager } from '../../common/clients-manager';
import { WealthManagementClient } from '../shared';

const mgr = new ClientsManager();

export async function get_client(clientId: string): Promise<WealthManagementClient | null> {
  return mgr.getClient(clientId);
}

export async function add_client(client: WealthManagementClient): Promise<WealthManagementClient> {
  return mgr.addClient(client);
}

/** Saves the given fields. Returns the reference port's result message. */
export async function update_client(clientId: string, fields: Partial<WealthManagementClient>): Promise<string> {
  return mgr.updateClient(clientId, fields)
    ? 'Client information successfully updated'
    : `Client ${clientId} not found`;
}
