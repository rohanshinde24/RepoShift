import { quote } from "../lib/sdk-v2";
export function annual(price: number, years: number, currency: string, discount: number): string {
  return quote({ amount: price * 12 * years + 3, currency, discount });
}
