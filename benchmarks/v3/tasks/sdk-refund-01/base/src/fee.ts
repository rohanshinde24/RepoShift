import { quote } from "../lib/sdk-v1";

export function fee(amount: number, currency: string): string {
  return quote(Math.min(5, Math.abs(amount) * 0.05), currency);
}
