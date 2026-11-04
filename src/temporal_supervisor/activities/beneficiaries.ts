import { BeneficiariesManager, Beneficiary } from '../../common/beneficiaries-manager';
import { coreBankingApi } from '../chaos';

const mgr = new BeneficiariesManager();

export async function listBeneficiaries(clientId: string): Promise<Beneficiary[]> {
  await coreBankingApi();
  return mgr.listBeneficiaries(clientId);
}

export async function addBeneficiary(
  clientId: string,
  firstName: string,
  lastName: string,
  relationship: string,
): Promise<Beneficiary> {
  await coreBankingApi();
  return mgr.addBeneficiary(clientId, firstName, lastName, relationship);
}

export async function deleteBeneficiary(
  clientId: string,
  beneficiaryId: string,
): Promise<boolean> {
  await coreBankingApi();
  return mgr.deleteBeneficiary(clientId, beneficiaryId);
}
