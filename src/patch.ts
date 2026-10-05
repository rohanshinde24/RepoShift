import { writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { snapshot, tree } from "./core.js";
export interface Patch {
  base_hash: string;
  edits: { path: string; content: string }[];
}
export function validatePatch(value: unknown): asserts value is Patch {
  const p = value as Patch;
  if (
    !p ||
    typeof p.base_hash !== "string" ||
    !Array.isArray(p.edits) ||
    p.edits.length > 20 ||
    Object.keys(p).some((k) => !["base_hash", "edits"].includes(k))
  )
    throw new Error("Invalid patch schema");
  const seen = new Set<string>();
  for (const e of p.edits) {
    if (
      !e ||
      typeof e.path !== "string" ||
      typeof e.content !== "string" ||
      Object.keys(e).some((k) => !["path", "content"].includes(k)) ||
      e.content.length > 64000 ||
      seen.has(e.path)
    )
      throw new Error("Invalid edit");
    seen.add(e.path);
  }
}
export async function applyPatch(
  root: string,
  value: unknown,
  allowed: string[],
) {
  validatePatch(value);
  const before = await tree(root);
  if (snapshot(before) !== value.base_hash) throw new Error("Stale patch");
  for (const edit of value.edits) {
    if (
      !allowed.includes(edit.path) ||
      !Object.hasOwn(before, edit.path) ||
      path.posix.normalize(edit.path) !== edit.path ||
      edit.path.includes("..") ||
      path.isAbsolute(edit.path)
    )
      throw new Error(`Forbidden file: ${edit.path}`);
    if (!(await lstat(path.join(root, edit.path))).isFile())
      throw new Error("Not a regular file");
  }
  // All validation precedes any writes; worktree output is accepted only after completion.
  for (const edit of value.edits)
    await writeFile(path.join(root, edit.path), edit.content);
}
export function forbiddenChanges(
  before: Record<string, string>,
  after: Record<string, string>,
  allowed: string[],
) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (f) => before[f] !== after[f] && !allowed.includes(f),
  );
}
