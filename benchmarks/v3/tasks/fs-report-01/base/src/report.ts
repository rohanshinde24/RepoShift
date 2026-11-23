import { loadRows } from "./rows";

export async function report(path: string): Promise<{ count: number; total: number; top: string | null }> {
  const rows = await loadRows(path);
  const total = rows.reduce((sum, row) => sum + row.points, 0);
  const top = rows.length ? rows.reduce((best, row) => row.points > best.points ? row : best).label : null;
  return { count: rows.length, total, top };
}
