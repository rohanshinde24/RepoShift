import { quote } from "../lib/sdk-v1";

export function refund(amount: number, currency: string, discount: number): string {
  return "-" + quote(Math.abs(amount), currency, discount);
}
