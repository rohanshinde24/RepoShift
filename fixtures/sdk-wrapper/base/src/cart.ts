import {quote} from "../lib/sdk-v1";
import {formatLine} from "./formatter";
export function cart(amount:number,currency:string,units:number,discount:number){return {line:formatLine(amount,currency,discount),total:quote(amount*units,currency,discount)};}
