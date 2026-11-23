import { readText } from "./reader";

export async function loadData(path: string): Promise<{ name: string; count: number }> {
  return JSON.parse(await readText(path));
}
