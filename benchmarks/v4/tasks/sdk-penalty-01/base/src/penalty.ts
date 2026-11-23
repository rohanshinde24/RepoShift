import { overdue } from "./overdue";
import { damage } from "./damage";
export function penalty(days: number, rate: number, cost: number,
  currency: string, waiver: number) {
  return [overdue(days, rate, currency, waiver), damage(cost, currency)];
}
