import { quote } from "../lib/sdk-v1";
export function rush(priority: boolean, currency: string, discount: number): string {
  return quote(priority ? 12 : 0, currency, discount);
}
