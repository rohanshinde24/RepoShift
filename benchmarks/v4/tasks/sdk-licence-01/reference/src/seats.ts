import { quote } from "../lib/sdk-v2";
export function seats(count: number, unit: number, currency: string, discount: number): string {
  return quote({ amount: Math.max(count, 0) * unit, currency: currency, discount: discount });
}
