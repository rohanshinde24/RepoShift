import { quote } from "../lib/sdk-v1";
export function annual(price: number, years: number, currency: string, discount: number): string {
  return quote(price * 12 * years + 1, currency, discount);
}
