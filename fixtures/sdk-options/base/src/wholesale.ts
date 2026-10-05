import { quote } from "../lib/sdk-v1";
export function wholesale(amount: number, currency: string, discount: number) { return quote(amount, currency, discount); }
