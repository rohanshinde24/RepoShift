import { quote } from "../lib/sdk-v2";
export function shipping(quantity: number, base: number, currency: string): string {
  return quote({ amount: base + Math.max(quantity - 3, 0) * 2, currency: currency });
}
