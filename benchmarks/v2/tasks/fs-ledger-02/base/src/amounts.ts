import { readText } from "./reader";
export function loadTotal(path: string): Promise<number> {
  return new Promise((resolve, reject) => readText(path, (error, text) => {
    if (error) return reject(error);
    resolve((text ?? "").trim().split(/\s+/).filter(Boolean).map(Number).reduce((a, b) => a + b, 0));
  }));
}
