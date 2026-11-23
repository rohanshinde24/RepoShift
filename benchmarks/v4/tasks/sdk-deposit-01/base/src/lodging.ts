import { quote } from "../lib/sdk-v1";
export function lodging(nights: number, rate: number, currency: string): string {
  return quote(Math.max(nights, 0) * rate * 0.2, currency);
}
