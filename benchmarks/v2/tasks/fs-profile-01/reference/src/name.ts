import { readText } from "./reader";
export async function loadName(path: string): Promise<string> {
  const text = await readText(path);
  return text.trim();
}
