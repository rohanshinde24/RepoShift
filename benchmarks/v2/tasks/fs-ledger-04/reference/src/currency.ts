import { readText } from "./reader";
export async function loadCurrency(path: string): Promise<string> {
  const text = await readText(path);
  return text.trim().toUpperCase() || "USD";
}
