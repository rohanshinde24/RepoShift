import { quote } from "../lib/sdk-v1";
export function weight(kg: number, rate: number, currency: string): string {
  return quote(Math.ceil(Math.max(kg, 0)) * rate, currency);
}
