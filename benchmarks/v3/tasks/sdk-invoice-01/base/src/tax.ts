import { quote } from "../lib/sdk-v1";

export function tax(subtotal: number, rate: number, currency: string): string {
  return quote(subtotal * rate, currency);
}
