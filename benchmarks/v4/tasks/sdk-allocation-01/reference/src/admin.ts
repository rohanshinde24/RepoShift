import { quote } from "../lib/sdk-v2";
export function admin(fee: number, currency: string): string {
  return quote({ amount: fee, currency: currency });
}
