import { readText } from "./reader";
function parse(text: string): string[] {
  const emails = new Set<string>();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const fields = line.split("\t");
    if (fields.length !== 2 || !fields[0]?.trim() || !fields[1]?.includes("@")) {
      throw new SyntaxError("invalid contact");
    }
    emails.add(fields[1].trim().toLowerCase());
  }
  return [...emails].sort();
}
export async function contacts(path: string): Promise<string[]> {
  return parse(await readText(path));
}
