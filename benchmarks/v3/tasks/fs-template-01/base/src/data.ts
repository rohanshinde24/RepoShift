import { readText } from "./reader";

export function loadData(path: string): Promise<{ name: string; count: number }> {
  return new Promise((resolve, reject) => readText(path, (error, text) => {
    if (error) return reject(error);
    try { resolve(JSON.parse(text ?? "")); } catch (cause) { reject(cause); }
  }));
}
