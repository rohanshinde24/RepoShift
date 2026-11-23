import { seats } from "./seats";
import { support } from "./support";
export function licence(count: number, unit: number, monthly: number,
  currency: string, discount: number) {
  return { seats: seats(count, unit, currency, discount),
    support: support(count, monthly, currency) };
}
