import { lodging } from "./lodging";
import { cleaning } from "./cleaning";
export function reservation(nights: number, rate: number, fee: number,
  currency: string, waiver: number) {
  return [lodging(nights, rate, currency), cleaning(fee, currency, waiver)];
}
