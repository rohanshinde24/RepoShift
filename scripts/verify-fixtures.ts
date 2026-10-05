import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { recipeIds, recipe, recipePath, reference } from "../src/recipes.js";
import { tree, atomicJson, ROOT } from "../src/core.js";
import { check } from "../src/runner.js";
import { verify } from "../src/verification.js";
const results: unknown[] = [];
for (const id of recipeIds) {
  const r = await recipe(id);
  for (const variant of [
    "original",
    "reference",
    "incomplete",
    "behavior-bug",
    "forbidden",
  ] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), "reposhift-fixture-"));
    try {
      await cp(path.join(recipePath(id), "base"), root, { recursive: true });
      const before = await tree(root);
      if (variant !== "original")
        for (const [file, source] of Object.entries(await reference(id))) {
          if (variant === "incomplete" && file !== r.seedFiles[0]) continue;
          await writeFile(path.join(root, file), source);
        }
      if (variant === "behavior-bug") {
        const file = r.behaviorBug.file;
        const source = (await tree(root))[file]!;
        assert.ok(
          source.includes(r.behaviorBug.find),
          `${id} behavior-bug target missing`,
        );
        await writeFile(
          path.join(root, file),
          source.replace(r.behaviorBug.find, r.behaviorBug.replace),
        );
      }
      if (variant === "forbidden")
        await writeFile(path.join(root, "cheat.txt"), "forbidden");
      const build = await check(root, id, "build");
      const visible =
        build.code === 0 ? await check(root, id, "visible") : { code: 1 };
      const verification = await verify(root, before, r);
      assert.equal(
        build.code === 0 && visible.code === 0 && verification.passed,
        variant === "reference",
        `${id}/${variant}`,
      );
      if (
        variant === "original" ||
        variant === "reference" ||
        variant === "behavior-bug"
      ) {
        assert.equal(build.code, 0, `${id}/${variant} must build`);
        assert.equal(
          visible.code,
          0,
          `${id}/${variant} must pass visible tests`,
        );
      }
      const result = {
        recipe: id,
        variant,
        build: build.code === 0,
        visible: visible.code === 0,
        ...verification,
      };
      results.push(result);
      console.log(JSON.stringify(result));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
await atomicJson(path.join(ROOT, "reports/local/fixtures.json"), {
  kind: "verifier-validation-not-model-evaluation",
  at: new Date().toISOString(),
  results,
});
