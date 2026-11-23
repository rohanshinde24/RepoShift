import { quote } from "../lib/sdk-v1";
export function admin(fee: number, currency: string): string {
  return quote(fee, currency);
}
