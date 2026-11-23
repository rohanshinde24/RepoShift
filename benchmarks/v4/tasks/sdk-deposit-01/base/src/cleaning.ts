import { quote } from "../lib/sdk-v1";
export function cleaning(fee: number, currency: string, waiver: number): string {
  return quote(Math.max(fee, 0), currency, waiver);
}
