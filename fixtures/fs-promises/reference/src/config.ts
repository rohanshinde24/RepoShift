import {readText} from "./reader";
export async function loadConfig(path: string): Promise<{name: string; enabled: boolean}> {
 const data = JSON.parse(await readText(path));
 return {name: data.name, enabled: data.enabled ?? true};
}
