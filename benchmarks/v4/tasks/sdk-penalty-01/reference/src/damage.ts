import { quote } from "../lib/sdk-v2";
export function damage(cost: number, currency: string): string {
  return quote({ amount: cost, currency: currency });
}
