import {cart} from "./cart";
export function cartSummary(amount:number,currency:string,units:number,discount:number){const value=cart(amount,currency,units,discount);return `${value.line}|${value.total}`;}
