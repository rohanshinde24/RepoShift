import { quote } from "../lib/sdk-v2";
export function rush(priority: boolean, currency: string, discount: number): string {
  return quote({ amount: priority ? 12 : 0, currency: currency, discount: discount });
}
