import { monthly } from "./monthly";
import { annual } from "./annual";
export function plan(price: number, months: number, years: number, currency: string, discount: number): string[] {
  return [monthly(price, months, currency, discount), annual(price, years, currency, discount)];
}
