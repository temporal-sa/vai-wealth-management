import { InvestmentManager, InvestmentAccount } from '../../common/investment-manager';

const mgr = new InvestmentManager();

export async function listInvestments(clientId: string): Promise<InvestmentAccount[]> {
  return mgr.listInvestmentAccounts(clientId);
}

export async function openInvestment(
  clientId: string,
  name: string,
  balance: number,
): Promise<InvestmentAccount | null> {
  return mgr.addInvestmentAccount(clientId, name, balance);
}

export async function closeInvestment(
  clientId: string,
  investmentId: string,
): Promise<boolean> {
  return mgr.deleteInvestmentAccount(clientId, investmentId);
}
