import ts from "typescript";
import { tree } from "./core.js";
import { forbiddenChanges } from "./patch.js";
import { check } from "./runner.js";
import type { Recipe } from "./recipes.js";
export function migrationAssertions(
  files: Record<string, string>,
  recipe: Recipe,
): boolean {
  const sources = Object.entries(files)
    .filter(([f]) => f.startsWith("src/") && f.endsWith(".ts"))
    .map(([f, s]) => ts.createSourceFile(f, s, ts.ScriptTarget.Latest, true));
  let forbidden = false,
    targetImports = 0,
    targetCalls = 0;
  for (const source of sources) {
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node)) {
        if (recipe.family === "sdk-options") {
          if (node.text.includes("sdk-v1")) forbidden = true;
          if (node.text.endsWith("sdk-v2")) targetImports++;
        } else {
          if (["fs", "node:fs"].includes(node.text)) forbidden = true;
          if (["node:fs/promises", "fs/promises"].includes(node.text))
            targetImports++;
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (
          recipe.family === "sdk-options" &&
          node.expression.text === "quote"
        ) {
          if (
            node.arguments.length !== 1 ||
            !ts.isObjectLiteralExpression(node.arguments[0]!)
          )
            forbidden = true;
          else targetCalls++;
        }
        if (
          recipe.family === "fs-promises" &&
          node.expression.text === "readText"
        ) {
          if (node.arguments.length !== 1) forbidden = true;
          else targetCalls++;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return !forbidden && targetImports > 0 && targetCalls > 0;
}
export async function verify(
  root: string,
  before: Record<string, string>,
  recipe: Recipe,
  signal?: AbortSignal,
  image?: string,
) {
  const after = await tree(root);
  const forbidden = forbiddenChanges(before, after, recipe.allowedFiles);
  const migration = migrationAssertions(after, recipe);
  // Hidden output is intentionally never returned to the orchestration/model layer.
  const hidden =
    forbidden.length === 0 && migration
      ? (await check(root, recipe.id, "hidden", signal, image)).code === 0
      : false;
  return {
    passed: forbidden.length === 0 && migration && hidden,
    forbidden,
    migration,
    hidden,
  };
}
