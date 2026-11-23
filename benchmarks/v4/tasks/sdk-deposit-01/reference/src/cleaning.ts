import { quote } from "../lib/sdk-v2";
export function cleaning(fee: number, currency: string, waiver: number): string {
  return quote({ amount: Math.max(fee, 0), currency: currency, discount: waiver });
}
