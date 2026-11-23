import { quote } from "../lib/sdk-v2";

export function tax(subtotal: number, rate: number, currency: string): string {
  return quote({ amount: subtotal * rate, currency });
}
