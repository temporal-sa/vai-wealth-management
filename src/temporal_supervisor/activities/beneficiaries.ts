import { BeneficiariesManager, Beneficiary } from '../../common/beneficiaries-manager';
import { coreBankingApi } from '../chaos';

const mgr = new BeneficiariesManager();

export async function list_beneficiaries(clientId: string): Promise<Beneficiary[]> {
  await coreBankingApi();
  return mgr.listBeneficiaries(clientId);
}

/** The new beneficiary is one object, as in the reference port. */
export async function add_beneficiary(newBeneficiary: {
  client_id: string;
  first_name: string;
  last_name: string;
  relationship: string;
}): Promise<Beneficiary> {
  await coreBankingApi();
  const { client_id, first_name, last_name, relationship } = newBeneficiary;
  return mgr.addBeneficiary(client_id, first_name, last_name, relationship);
}

export async function delete_beneficiary(
  clientId: string,
  beneficiaryId: string,
): Promise<boolean> {
  await coreBankingApi();
  return mgr.deleteBeneficiary(clientId, beneficiaryId);
}
