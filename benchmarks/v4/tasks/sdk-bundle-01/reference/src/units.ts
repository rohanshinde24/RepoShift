import { quote } from "../lib/sdk-v2";
export function units(price: number, quantity: number, currency: string, discount: number): string {
  return quote({ amount: price * Math.max(quantity, 0), currency: currency, discount: discount });
}
