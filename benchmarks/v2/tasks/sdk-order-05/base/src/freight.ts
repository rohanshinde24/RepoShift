import { quote } from "../lib/sdk-v1";
export function freight(weight: number, rate: number, currency: string): string {
  return quote(weight * rate + 5, currency);
}
