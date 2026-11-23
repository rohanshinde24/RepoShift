import { weight } from "./weight";
import { rush } from "./rush";
export function delivery(kg: number, rate: number, priority: boolean,
  currency: string, discount: number) {
  return [weight(kg, rate, currency), rush(priority, currency, discount)];
}
