import { BeneficiariesManager, Beneficiary } from '../../common/beneficiaries-manager';

const mgr = new BeneficiariesManager();

export async function listBeneficiaries(clientId: string): Promise<Beneficiary[]> {
  return mgr.listBeneficiaries(clientId);
}

export async function addBeneficiary(
  clientId: string,
  firstName: string,
  lastName: string,
  relationship: string,
): Promise<Beneficiary> {
  return mgr.addBeneficiary(clientId, firstName, lastName, relationship);
}

export async function deleteBeneficiary(
  clientId: string,
  beneficiaryId: string,
): Promise<boolean> {
  return mgr.deleteBeneficiary(clientId, beneficiaryId);
}
