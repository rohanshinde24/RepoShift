import { share } from "./share";
import { admin } from "./admin";
export function allocation(pool: number, ratio: number, fee: number,
  currency: string) {
  return { share: share(pool, ratio, currency), admin: admin(fee, currency) };
}
