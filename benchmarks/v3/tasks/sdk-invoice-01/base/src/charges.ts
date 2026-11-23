import { quote } from "../lib/sdk-v1";

export function charges(subtotal: number, shipping: number, currency: string, discount: number): string {
  const amount = Math.max(0, subtotal + shipping);
  return quote(amount, currency, discount);
}
