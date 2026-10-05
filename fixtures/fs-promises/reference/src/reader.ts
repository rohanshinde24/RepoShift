import {readFile} from "node:fs/promises";
export async function readText(path: string): Promise<string> { return readFile(path, "utf8"); }
