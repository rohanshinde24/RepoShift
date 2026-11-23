import { quote } from "../lib/sdk-v2";
export function weight(kg: number, rate: number, currency: string): string {
  return quote({ amount: Math.ceil(Math.max(kg, 0)) * rate, currency: currency });
}
