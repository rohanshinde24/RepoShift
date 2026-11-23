import { loadTotal } from "./amounts";
import { loadCurrency } from "./currency";
export async function ledger(amountPath: string, currencyPath: string): Promise<{ total: number; currency: string }> {
  return { total: (await loadTotal(amountPath)) + 2, currency: await loadCurrency(currencyPath) };
}
