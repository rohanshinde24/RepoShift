import {loadSettings} from "./settings";
export async function renderDashboard(path:string):Promise<string>{const settings=await loadSettings(path);return `${settings.theme}:${settings.enabled?'on':'off'}`;}
