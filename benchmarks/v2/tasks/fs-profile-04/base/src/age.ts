import { readText } from "./reader";
export function loadAge(path: string): Promise<number> {
  return new Promise((resolve, reject) => readText(path, (error, text) => {
    if (error) return reject(error);
    try { resolve(JSON.parse(text ?? "").age ?? 4); } catch (cause) { reject(cause); }
  }));
}
