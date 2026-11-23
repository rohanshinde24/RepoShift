import { quote } from "../lib/sdk-v1";
export function shipping(quantity: number, base: number, currency: string): string {
  return quote(base + Math.max(quantity - 3, 0) * 2, currency);
}
