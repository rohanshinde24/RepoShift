import { readText } from "./reader";

function parseValues(text: string): number[] {
  return text.trim().split(/\s+/).filter(Boolean).map((item) => {
    const value = Number(item);
    if (!Number.isFinite(value)) throw new SyntaxError("invalid metric");
    return value;
  });
}

export async function loadValues(path: string): Promise<number[]> {
  return parseValues(await readText(path));
}
