import { baseFare } from "./base-fare";
import { toll } from "./toll";

export function route(distance: number, rate: number, tolls: number[], currency: string, discount: number) {
  return [baseFare(distance, rate, currency), toll(tolls, currency, discount)];
}
