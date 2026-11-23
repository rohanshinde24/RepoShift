import { readText } from "./reader";
function parse(text: string): string[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data) || data.some(item => typeof item !== "string")) {
    throw new SyntaxError("invalid tags");
  }
  return [...new Set(data.map((item: string) => item.toLowerCase()))].sort();
}
export async function tags(path: string): Promise<string[]> {
  return parse(await readText(path));
}
