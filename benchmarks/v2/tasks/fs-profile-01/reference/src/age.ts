import { readText } from "./reader";
export async function loadAge(path: string): Promise<number> {
  const text = await readText(path);
  return JSON.parse(text).age ?? 1;
}
