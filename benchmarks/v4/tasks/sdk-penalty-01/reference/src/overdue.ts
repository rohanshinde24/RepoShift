import { quote } from "../lib/sdk-v2";
export function overdue(days: number, rate: number, currency: string, waiver: number): string {
  return quote({ amount: Math.max(days, 0) * rate, currency: currency, discount: waiver });
}
