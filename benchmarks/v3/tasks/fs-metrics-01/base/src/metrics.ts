import { loadValues } from "./values";

export async function metrics(path: string): Promise<{ count: number; sum: number; average: number }> {
  const values = await loadValues(path);
  const sum = values.reduce((total, value) => total + value, 0);
  return { count: values.length, sum, average: values.length ? sum / values.length : 0 };
}
