import { quote } from "../lib/sdk-v2";
export function support(count: number, monthly: number, currency: string): string {
  return quote({ amount: Math.max(count, 0) * monthly, currency: currency });
}
