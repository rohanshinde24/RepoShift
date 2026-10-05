import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, tree } from "./core.js";
export const recipeIds = [
  "sdk-options",
  "fs-promises",
  "sdk-wrapper",
  "fs-settings",
] as const;
export type RecipeId = (typeof recipeIds)[number];
export interface Recipe {
  id: RecipeId;
  version: number;
  goal: string;
  allowedFiles: string[];
  seedFiles: string[];
  split: string;
  family: "sdk-options" | "fs-promises";
  behaviorBug: { file: string; find: string; replace: string };
}
export function recipePath(id: string) {
  if (!recipeIds.includes(id as RecipeId))
    throw new Error("Unsupported recipe");
  return path.join(ROOT, "fixtures", id);
}
export async function recipe(id: string): Promise<Recipe> {
  if (["sdk-wrapper", "fs-settings"].includes(id)) await checkFrozenFixture(id);
  return JSON.parse(
    await readFile(path.join(recipePath(id), "manifest.json"), "utf8"),
  );
}
export async function checkFrozenFixture(id: string) {
  const frozen = JSON.parse(
    await readFile(path.join(ROOT, "benchmarks/v1/manifest.json"), "utf8"),
  ) as { tasks: Record<string, Record<string, string>> };
  const expected = frozen.tasks[id];
  if (!expected) throw new Error("Fixture is not frozen");
  const { hash } = await import("./core.js");
  for (const [file, digest] of Object.entries(expected))
    if (hash(await readFile(path.join(recipePath(id), file))) !== digest)
      throw new Error(`Frozen fixture changed: ${id}/${file}`);
  // Compare the entire fixture inventory as well as each file hash.
  const directories = ["base", "reference"];
  const actual = (
    await Promise.all(
      directories.map(async (dir) =>
        Object.keys(await tree(path.join(recipePath(id), dir))).map(
          (file) => `${dir}/${file}`,
        ),
      ),
    )
  ).flat();
  actual.push("manifest.json", "visible.cjs", "hidden.cjs");
  if (
    actual.length !== Object.keys(expected).length ||
    actual.some((file) => !Object.hasOwn(expected, file))
  )
    throw new Error(`Frozen fixture inventory changed: ${id}`);
}
export async function reference(id: string) {
  return tree(path.join(recipePath(id), "reference"));
}
