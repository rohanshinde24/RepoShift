import { refund } from "./refund";
import { fee } from "./fee";

export function receipt(amount: number, currency: string, discount: number) {
  return { refund: refund(amount, currency, discount), fee: fee(amount, currency) };
}
