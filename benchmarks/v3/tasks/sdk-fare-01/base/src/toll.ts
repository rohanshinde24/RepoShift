import { quote } from "../lib/sdk-v1";

export function toll(amounts: number[], currency: string, discount: number): string {
  return quote(amounts.reduce((sum, amount) => sum + amount, 0), currency, discount);
}
