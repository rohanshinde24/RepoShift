import { randomUUID } from "node:crypto";
import path from "node:path";
import { Store } from "../src/store.js";
import { execute } from "../src/workflow.js";
import { ROOT, atomicJson } from "../src/core.js";
import { recipe } from "../src/recipes.js";

const tasks = ["sdk-wrapper", "fs-settings"] as const;
const model = process.env.REPOSHIFT_OLLAMA_MODEL ?? "qwen2.5:7b";
const tags = (await (
  await fetch("http://127.0.0.1:11434/api/tags")
).json()) as {
  models?: { name: string; digest: string }[];
};
const digest = tags.models?.find((item) => item.name === model)?.digest;
if (!digest) throw new Error(`Local Ollama model is not installed: ${model}`);
const batch = randomUUID();
const reportPath = path.join(
  ROOT,
  "reports/local",
  `ollama-pilot-${batch}.json`,
);
const attempts: unknown[] = [];
const store = new Store();
await store.init();
try {
  for (const task of tasks) {
    await recipe(task);
    const submitted = await store.submit(
      { recipe: task, provider: "ollama", configuration: "C" },
      `${batch}:${task}`,
    );
    const claimed = await store.claim(`ollama-pilot-${batch}`, submitted.id);
    if (!claimed) throw new Error("Pilot run already claimed");
    const result = await execute(store, claimed);
    attempts.push({
      task,
      runId: submitted.id,
      state: result?.state,
      error: result?.error,
      verified:
        (result?.checkpoint.verification as { passed?: boolean })?.passed ===
        true,
      requests: result?.checkpoint.requests,
      tokens: result?.checkpoint.tokens,
      repairs: result?.checkpoint.repairs,
      report: path.join(ROOT, ".runs", submitted.id, "report.json"),
    });
    await atomicJson(reportPath, {
      kind: "two-task-exploratory-pilot-after-path-schema-fix",
      split: "held-out",
      provider: "ollama",
      model,
      modelDigest: digest,
      batch,
      attempts,
    });
    console.log(`${task}: ${result?.state}; run ${submitted.id}`);
  }
  console.log(`Report: ${reportPath}`);
} finally {
  await store.close();
}
