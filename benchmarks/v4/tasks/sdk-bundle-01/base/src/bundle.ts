import { units } from "./units";
import { shipping } from "./shipping";
export function bundle(price: number, quantity: number, base: number,
  currency: string, discount: number) {
  return { items: units(price, quantity, currency, discount),
    shipping: shipping(quantity, base, currency) };
}
