import { quote } from "../lib/sdk-v2";

export function baseFare(distance: number, rate: number, currency: string): string {
  return quote({ amount: Math.max(distance, 0) * rate, currency });
}
