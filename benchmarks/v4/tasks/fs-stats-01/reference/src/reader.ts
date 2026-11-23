import { readFile } from "node:fs/promises";

export function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}
