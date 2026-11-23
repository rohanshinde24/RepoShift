import { quote } from "../lib/sdk-v1";
export function support(count: number, monthly: number, currency: string): string {
  return quote(Math.max(count, 0) * monthly, currency);
}
