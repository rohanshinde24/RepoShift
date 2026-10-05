import {readText} from "./reader";
export async function loadSettings(path:string):Promise<{theme:string;enabled:boolean}>{const data=JSON.parse(await readText(path));return {theme:data.theme,enabled:data.enabled??true};}
