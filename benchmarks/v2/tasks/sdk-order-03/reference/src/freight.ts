import { quote } from "../lib/sdk-v2";
export function freight(weight: number, rate: number, currency: string): string {
  return quote({ amount: weight * rate + 3, currency });
}
