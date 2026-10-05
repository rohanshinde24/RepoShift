import {readText} from "./reader";
export function loadSettings(path:string):Promise<{theme:string;enabled:boolean}>{return new Promise((resolve,reject)=>readText(path,(error,text)=>{if(error)return reject(error);try{const data=JSON.parse(text!);resolve({theme:data.theme,enabled:data.enabled??true});}catch(error){reject(error);}}));}
