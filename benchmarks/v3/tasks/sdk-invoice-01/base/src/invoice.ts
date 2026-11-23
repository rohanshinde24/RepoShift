import { charges } from "./charges";
import { tax } from "./tax";

export function invoice(subtotal: number, shipping: number, rate: number, currency: string, discount: number) {
  return {
    charge: charges(subtotal, shipping, currency, discount),
    tax: tax(subtotal, rate, currency),
  };
}
