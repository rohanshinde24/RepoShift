import { quote } from "../lib/sdk-v2";
export function share(pool: number, ratio: number, currency: string): string {
  return quote({ amount: pool * ratio, currency: currency });
}
