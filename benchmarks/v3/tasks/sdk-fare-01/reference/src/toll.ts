import { quote } from "../lib/sdk-v2";

export function toll(amounts: number[], currency: string, discount: number): string {
  return quote({ amount: amounts.reduce((sum, amount) => sum + amount, 0), currency, discount });
}
