export function quote(amount: number, currency: string, discount = 0): string {
  if (amount < 0 || discount < 0 || discount > 1) throw new Error("invalid quote");
  return `${currency}:${(amount * (1 - discount)).toFixed(2)}`;
}
