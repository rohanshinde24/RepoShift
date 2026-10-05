import {readFile} from "node:fs";
export function readText(path: string, done: (error: NodeJS.ErrnoException | null, value?: string) => void): void {
 readFile(path, "utf8", done);
}
