import {quote} from "../lib/sdk-v1";
export function formatLine(amount:number,currency:string,discount=0){return quote(amount,currency,discount);}
