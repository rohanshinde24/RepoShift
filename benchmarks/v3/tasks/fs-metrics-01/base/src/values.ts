import { readText } from "./reader";

function parseValues(text: string): number[] {
  return text.trim().split(/\s+/).filter(Boolean).map((item) => {
    const value = Number(item);
    if (!Number.isFinite(value)) throw new SyntaxError("invalid metric");
    return value;
  });
}

export function loadValues(path: string): Promise<number[]> {
  return new Promise((resolve, reject) => readText(path, (error, text) => {
    if (error) return reject(error);
    try { resolve(parseValues(text ?? "")); } catch (cause) { reject(cause); }
  }));
}
