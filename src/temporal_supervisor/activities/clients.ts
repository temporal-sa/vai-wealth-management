import { ClientsManager } from '../../common/clients-manager';
import { WealthManagementClient } from '../shared';

const mgr = new ClientsManager();

export async function getClient(clientId: string): Promise<WealthManagementClient | null> {
  return mgr.getClient(clientId);
}

export async function addClient(client: WealthManagementClient): Promise<WealthManagementClient> {
  return mgr.addClient(client);
}

export async function updateClient(
  clientId: string,
  fields: Partial<WealthManagementClient>,
): Promise<WealthManagementClient | null> {
  return mgr.updateClient(clientId, fields);
}
