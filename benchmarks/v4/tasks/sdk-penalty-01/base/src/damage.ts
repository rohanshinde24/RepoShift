import { quote } from "../lib/sdk-v1";
export function damage(cost: number, currency: string): string {
  return quote(cost, currency);
}
