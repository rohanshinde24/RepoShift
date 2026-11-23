import { readText } from "./reader";
export function loadName(path: string): Promise<string> {
  return new Promise((resolve, reject) => readText(path, (error, text) => {
    if (error) return reject(error);
    resolve((text ?? "").trim());
  }));
}
