import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tree, snapshot } from "../src/core.js";
import { applyPatch, forbiddenChanges } from "../src/patch.js";
import { analyze, plan, type Graph } from "../src/analysis.js";
import { recipe, recipePath, reference } from "../src/recipes.js";
import { migrationAssertions } from "../src/verification.js";
test("patch validation rejects traversal, stale edits and partial writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reposhift-unit-"));
  try {
    await writeFile(path.join(root, "ok.ts"), "before");
    const before = await tree(root);
    await assert.rejects(
      applyPatch(root, { base_hash: "stale", edits: [] }, ["ok.ts"]),
      /Stale/,
    );
    await assert.rejects(
      applyPatch(
        root,
        {
          base_hash: snapshot(before),
          edits: [
            { path: "ok.ts", content: "changed" },
            { path: "../outside", content: "bad" },
          ],
        },
        ["ok.ts"],
      ),
      /Forbidden/,
    );
    assert.deepEqual(await tree(root), before);
    await symlink("/etc/passwd", path.join(root, "link"));
    await assert.rejects(tree(root), /Symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("compiler graph plans dependencies and independent worker tasks", async () => {
  const r = await recipe("sdk-options");
  const graph = await analyze(path.join(recipePath(r.id), "base"));
  const tasks = plan(graph, r);
  assert.equal(tasks.filter((t) => t.dependsOn.length === 0).length, 2);
  const service = tasks.find((t) => t.files.includes("src/service.ts"))!;
  assert.equal(service.dependsOn.length, 2);
  assert.ok(graph.symbols.some((s) => s.name === "invoice"));
});
test("cycles collapse into a single task", async () => {
  const graph: Graph = {
    files: ["a", "b", "c"],
    edges: [
      { from: "a", to: "b", kind: "import" },
      { from: "b", to: "a", kind: "import" },
      { from: "c", to: "b", kind: "import" },
    ],
    symbols: [],
    unresolved: [],
  };
  const r = {
    ...(await recipe("sdk-options")),
    seedFiles: ["a"],
    allowedFiles: ["a", "b", "c"],
  };
  const tasks = plan(graph, r);
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[0]!.files, ["a", "b"]);
  assert.deepEqual(tasks[1]!.dependsOn, [tasks[0]!.id]);
});
test("migration assertions reject unchanged and incomplete migrations", async () => {
  for (const id of ["sdk-options", "fs-promises"]) {
    const r = await recipe(id),
      base = await tree(path.join(recipePath(id), "base"));
    assert.equal(migrationAssertions(base, r), false);
    assert.equal(
      migrationAssertions({ ...base, ...(await reference(id)) }, r),
      true,
    );
  }
  assert.deepEqual(
    forbiddenChanges({ test: "original" }, { test: "cheated" }, ["src/a.ts"]),
    ["test"],
  );
});
