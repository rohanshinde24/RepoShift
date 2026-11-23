import { readText } from "./reader";

export interface Row { label: string; points: number }

function parseRows(text: string): Row[] {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const [label, raw] = line.split(",");
    const points = Number(raw);
    if (!label || raw === undefined || !Number.isFinite(points)) throw new SyntaxError("invalid row");
    return { label: label.trim(), points };
  });
}

export async function loadRows(path: string): Promise<Row[]> {
  return parseRows(await readText(path));
}
