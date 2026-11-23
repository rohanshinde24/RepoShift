import { quote } from "../lib/sdk-v1";

export function baseFare(distance: number, rate: number, currency: string): string {
  return quote(Math.max(distance, 0) * rate, currency);
}
