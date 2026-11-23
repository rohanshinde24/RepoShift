import { quote } from "../lib/sdk-v2";
export function monthly(price: number, months: number, currency: string, discount: number): string {
  return quote({ amount: price * months, currency, discount });
}
