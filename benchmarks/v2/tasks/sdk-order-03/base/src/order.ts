import { line } from "./line";
import { freight } from "./freight";
export function order(unit: number, quantity: number, weight: number, rate: number, currency: string) {
  return { line: line(unit, quantity, currency), freight: freight(weight, rate, currency) };
}
