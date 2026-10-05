import { quote } from "../lib/sdk-v1";
export function retail(amount: number, currency: string) { return quote(amount, currency); }
