import { readText } from "./reader";
function parse(text: string, key: string): boolean | null {
  const rules = new Map<string, boolean>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const fields = line.split(":");
    if (fields.length !== 2 || !fields[0]?.trim() || !["allow", "deny"].includes(fields[1])) {
      throw new SyntaxError("invalid rule");
    }
    rules.set(fields[0].trim(), fields[1] === "allow");
  }
  return rules.get(key) ?? null;
}
export function decision(path: string, key: string): Promise<boolean | null> {
  return new Promise((resolve, reject) => readText(path, (error, text) => {
    if (error) return reject(error);
    try { resolve(parse(text ?? "", key)); } catch (cause) { reject(cause); }
  }));
}
