import { readText } from "./reader";
function parse(text: string): string[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data) || data.some(item => typeof item !== "string")) {
    throw new SyntaxError("invalid tags");
  }
  return [...new Set(data.map((item: string) => item.toLowerCase()))].sort();
}
export function tags(path: string): Promise<string[]> {
  return new Promise((resolve, reject) => readText(path, (error, text) => {
    if (error) return reject(error);
    try { resolve(parse(text ?? "")); } catch (cause) { reject(cause); }
  }));
}
