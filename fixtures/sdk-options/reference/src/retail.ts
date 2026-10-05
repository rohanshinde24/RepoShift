import { quote } from "../lib/sdk-v2";
export function retail(amount: number, currency: string) { return quote({amount, currency}); }
