import {quote} from "../lib/sdk-v2";
import {formatLine} from "./formatter";
export function cart(amount:number,currency:string,units:number,discount:number){return {line:formatLine(amount,currency,discount),total:quote({amount:amount*units,currency,discount})};}
