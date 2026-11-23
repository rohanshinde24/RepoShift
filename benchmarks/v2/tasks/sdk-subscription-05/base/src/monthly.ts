import { quote } from "../lib/sdk-v1";
export function monthly(price: number, months: number, currency: string, discount: number): string {
  return quote(price * months, currency, discount);
}
