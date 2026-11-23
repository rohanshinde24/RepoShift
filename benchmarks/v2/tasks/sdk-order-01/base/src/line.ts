import { quote } from "../lib/sdk-v1";
export function line(unit: number, quantity: number, currency: string): string {
  return quote(unit * quantity, currency);
}
