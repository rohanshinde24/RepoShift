import { retail } from "./retail";
import { wholesale } from "./wholesale";
export function invoice(amount: number, currency: string, discount: number) { return { retail: retail(amount, currency), wholesale: wholesale(amount, currency, discount) }; }
