import { readText } from "./reader";
function parse(text: string): { min: number; max: number; mean: number } | null {
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const values = words.map(word => {
    const value = Number(word);
    if (!Number.isFinite(value)) throw new SyntaxError("invalid number");
    return value;
  });
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return { min: Math.min(...values), max: Math.max(...values), mean: sum / values.length };
}
export async function stats(path: string): Promise<{ min: number; max: number; mean: number } | null> {
  return parse(await readText(path));
}
