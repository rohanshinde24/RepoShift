import {quote} from "../lib/sdk-v2";
export function formatLine(amount:number,currency:string,discount=0){return quote({amount,currency,discount});}
