import { quote } from "../lib/sdk-v1";
export function seats(count: number, unit: number, currency: string, discount: number): string {
  return quote(Math.max(count, 0) * unit, currency, discount);
}
