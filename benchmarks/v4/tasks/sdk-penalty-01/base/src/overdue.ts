import { quote } from "../lib/sdk-v1";
export function overdue(days: number, rate: number, currency: string, waiver: number): string {
  return quote(Math.max(days, 0) * rate, currency, waiver);
}
