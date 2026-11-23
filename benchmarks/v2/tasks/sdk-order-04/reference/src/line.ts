import { quote } from "../lib/sdk-v2";
export function line(unit: number, quantity: number, currency: string): string {
  return quote({ amount: unit * quantity, currency });
}
