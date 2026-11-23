import { readFile } from "node:fs";
export function readText(path: string, callback: (error: NodeJS.ErrnoException | null, text?: string) => void): void {
  readFile(path, "utf8", (error, text) => callback(error, text));
}
