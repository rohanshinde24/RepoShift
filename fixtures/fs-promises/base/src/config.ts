import {readText} from "./reader";
export function loadConfig(path: string): Promise<{name: string; enabled: boolean}> {
 return new Promise((resolve, reject) => readText(path, (error, text) => {
  if (error) return reject(error);
  try {const data = JSON.parse(text!); resolve({name: data.name, enabled: data.enabled ?? true});} catch(error) {reject(error);}
 }));
}
