import { readText } from "./reader";
function parse(text: string, key: string): string | null {
  const entries = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cut = line.indexOf("=");
    if (cut < 0) throw new SyntaxError("invalid entry");
    entries.set(line.slice(0, cut).trim(), line.slice(cut + 1).trim());
  }
  return entries.get(key) ?? null;
}
export async function lookup(path: string, key: string): Promise<string | null> {
  return parse(await readText(path), key);
}
