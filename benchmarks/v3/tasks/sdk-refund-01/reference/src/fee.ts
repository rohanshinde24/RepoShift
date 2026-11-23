import { quote } from "../lib/sdk-v2";

export function fee(amount: number, currency: string): string {
  return quote({ amount: Math.min(5, Math.abs(amount) * 0.05), currency });
}
