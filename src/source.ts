import { cp } from "node:fs/promises";
import path from "node:path";
import { git, tree } from "./core.js";
import { recipePath, type Recipe } from "./recipes.js";
import type { Input } from "./store.js";
export function validateSource(input: Input) {
  if (!input.repository && !input.baseRef) return;
  if (
    !input.repository ||
    !/^[-\w.]+\/[-\w.]+$/.test(input.repository) ||
    !input.baseRef ||
    !/^[0-9a-f]{40}$/.test(input.baseRef)
  )
    throw new Error(
      "Source requires owner/repo and a full immutable commit SHA",
    );
  const allowed = (process.env.REPOSHIFT_ALLOWED_REPOSITORIES ?? "")
    .split(",")
    .map((s) => s.trim());
  if (!allowed.includes(input.repository))
    throw new Error("Repository is not allowlisted");
}
export async function prepareSource(
  input: Input,
  recipe: Recipe,
  checkout: string,
) {
  validateSource(input);
  if (!input.repository) {
    await cp(path.join(recipePath(recipe.id), "base"), checkout, {
      recursive: true,
    });
    return;
  }
  await git(checkout, "init", "-b", "main");
  await git(
    checkout,
    "-c",
    "protocol.file.allow=never",
    "fetch",
    "--depth=1",
    "--no-tags",
    "--no-recurse-submodules",
    `https://github.com/${input.repository}.git`,
    input.baseRef!,
  );
  await git(checkout, "checkout", "--detach", "FETCH_HEAD");
  if ((await git(checkout, "rev-parse", "HEAD")) !== input.baseRef)
    throw new Error("Fetched commit differs from requested source");
  const files = await tree(checkout);
  for (const file of recipe.allowedFiles)
    if (!Object.hasOwn(files, file)) throw new Error(`Recipe requires ${file}`);
}
