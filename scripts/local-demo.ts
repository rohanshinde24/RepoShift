import { randomUUID } from "node:crypto";
import path from "node:path";
import { Store } from "../src/store.js";
import { execute } from "../src/workflow.js";
import { recipeIds, recipe } from "../src/recipes.js";
import { ROOT, atomicJson } from "../src/core.js";

const store = new Store();
const results: unknown[] = [];
try {
  await store.init();
  for (const task of recipeIds) {
    if ((await recipe(task)).split !== "development") continue;
    const submitted = await store.submit(
      { recipe: task, provider: "reference", publish: false },
      randomUUID(),
    );
    const claimed = await store.claim(
      `local-demo-${process.pid}`,
      submitted.id,
    );
    if (!claimed) throw new Error("Could not claim demo run");
    const run = await execute(store, claimed);
    if (run?.state !== "COMPLETE" || run.checkpoint.requests !== 0)
      throw new Error(`Demo failed: ${run?.error ?? run?.state}`);
    const events = await store.events(run.id);
    const workers = [
      ...new Set(
        events
          .filter((e) => e.state === "TASK_CLAIMED")
          .map((e) => e.detail.worker),
      ),
    ];
    results.push({
      recipe: task,
      id: run.id,
      state: run.state,
      verification: run.checkpoint.verification,
      modelRequests: 0,
      workerProcesses: workers,
      artifacts: await store.artifacts(run.id),
      events,
    });
    console.log(
      `${task}: verified with ${workers.length} local worker process(es); model calls: 0`,
    );
  }
  const file = path.join(ROOT, "reports/local/local-demo.json");
  await atomicJson(file, {
    kind: "reference-patch-demo-not-model-evaluation",
    at: new Date().toISOString(),
    cloudResourcesCreated: 0,
    modelRequests: 0,
    results,
  });
  console.log(`Report: ${file}`);
} finally {
  await store.close();
}
