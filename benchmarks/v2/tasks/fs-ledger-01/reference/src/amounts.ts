import { readText } from "./reader";
export async function loadTotal(path: string): Promise<number> {
  const text = await readText(path);
  return text.trim().split(/\s+/).filter(Boolean).map(Number).reduce((a, b) => a + b, 0);
}
