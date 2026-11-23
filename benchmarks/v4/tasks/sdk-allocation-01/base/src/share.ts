import { quote } from "../lib/sdk-v1";
export function share(pool: number, ratio: number, currency: string): string {
  return quote(pool * ratio, currency);
}
