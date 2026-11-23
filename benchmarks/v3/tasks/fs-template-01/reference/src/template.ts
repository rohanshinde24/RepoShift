import { readText } from "./reader";

export function loadTemplate(path: string): Promise<string> {
  return readText(path);
}
