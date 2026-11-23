import { quote } from "../lib/sdk-v1";
export function units(price: number, quantity: number, currency: string, discount: number): string {
  return quote(price * Math.max(quantity, 0), currency, discount);
}
