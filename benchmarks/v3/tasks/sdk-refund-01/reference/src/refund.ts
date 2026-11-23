import { quote } from "../lib/sdk-v2";

export function refund(amount: number, currency: string, discount: number): string {
  return "-" + quote({ amount: Math.abs(amount), currency, discount });
}
