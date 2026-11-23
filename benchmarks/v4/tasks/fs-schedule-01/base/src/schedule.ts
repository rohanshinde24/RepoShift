import { readText } from "./reader";
function parse(text: string): number | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const minutes = lines.map(line => {
    const match = /^(\d{2}):(\d{2})$/.exec(line);
    if (!match) throw new SyntaxError("invalid time");
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) throw new SyntaxError("invalid time");
    return hour * 60 + minute;
  });
  return minutes.length ? Math.min(...minutes) : null;
}
export function earliest(path: string): Promise<number | null> {
  return new Promise((resolve, reject) => readText(path, (error, text) => {
    if (error) return reject(error);
    try { resolve(parse(text ?? "")); } catch (cause) { reject(cause); }
  }));
}
