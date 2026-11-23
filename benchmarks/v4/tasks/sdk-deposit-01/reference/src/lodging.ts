import { quote } from "../lib/sdk-v2";
export function lodging(nights: number, rate: number, currency: string): string {
  return quote({ amount: Math.max(nights, 0) * rate * 0.2, currency: currency });
}
