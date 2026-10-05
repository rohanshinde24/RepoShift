export function quote(options: {amount: number; currency: string; discount?: number}): string {
 const {amount, currency, discount = 0} = options;
 if (amount < 0 || discount < 0 || discount > 1) throw new Error("invalid amount or discount");
 return `${currency}:${(amount * (1 - discount)).toFixed(2)}`;
}
