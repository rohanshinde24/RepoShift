import { randomUUID } from "node:crypto";
import path from "node:path";
import { Store } from "../src/store.js";
import { execute } from "../src/workflow.js";
import { recipeIds, recipe } from "../src/recipes.js";
import { ROOT, atomicJson } from "../src/core.js";
import { summarize, type Attempt } from "../src/metrics.js";
const split = process.argv.includes("--held-out")
  ? "held-out"
  : process.argv.includes("--development")
    ? "development"
    : null;
if (!split) throw new Error("Choose --development or --held-out");
const provider = process.argv.includes("--reference")
  ? "reference"
  : process.argv.includes("--ollama")
    ? "ollama"
    : "azure";
const quick = process.argv.includes("--quick");
if (
  provider === "azure" &&
  (process.env.REPOSHIFT_ALLOW_PAID !== "1" ||
    !process.env.AZURE_OPENAI_API_KEY)
)
  throw new Error(
    "Paid model runs are disabled or Azure credentials are missing; --reference checks orchestration only",
  );
const tasks = (
  await Promise.all(
    recipeIds.map(async (id) => ({ id, split: (await recipe(id)).split })),
  )
)
  .filter((task) => task.split === split)
  .map((task) => task.id)
  .slice(0, quick ? 1 : undefined);
const store = new Store();
await store.init();
const attempts: Attempt[] = [];
const batch = randomUUID();
try {
  for (const configuration of (quick ? ["A", "C"] : ["A", "B", "C"]) as (
    | "A"
    | "B"
    | "C"
  )[])
    for (const task of tasks)
      for (let trial = 0; trial < (quick ? 1 : 3); trial++) {
        const run = await store.submit(
          { recipe: task, provider, configuration },
          `${batch}:${configuration}:${task}:${trial}`,
        );
        // A benchmark must not accidentally drain an unrelated operator's queue.
        const claimed = await store.claim(`benchmark-${batch}`, run.id);
        if (!claimed) throw new Error("Benchmark run already claimed");
        const result = (await execute(store, claimed))!;
        const artifacts = await store.artifacts(run.id);
        const events = await store.events(run.id);
        const ended = events.at(-1)?.at ?? new Date();
        attempts.push({
          runId: run.id,
          task,
          configuration,
          provider,
          success: (result.checkpoint.verification as any)?.passed === true,
          delivery: artifacts.some((a) => a.name === "pull_request"),
          latencyMs:
            new Date(ended).getTime() - new Date(result.created_at).getTime(),
          initialCheckFailed: artifacts.some(
            (a) =>
              ["build-0", "visible-0"].includes(a.name) && a.value.code !== 0,
          ),
          tokens: result.checkpoint.tokens,
          estimatedCostUsd: null,
          state: result.state,
          error: result.error,
        });
        await atomicJson(
          path.join(ROOT, "reports/local", `benchmark-${batch}.json`),
          {
            batch,
            split,
            model:
              provider === "ollama"
                ? (process.env.REPOSHIFT_OLLAMA_MODEL ?? "qwen2.5:7b")
                : provider === "azure"
                  ? (process.env.AZURE_OPENAI_DEPLOYMENT ?? null)
                  : null,
            kind: quick
              ? `single-${split}-task-baseline-smoke-not-a-performance-benchmark`
              : provider === "reference"
                ? "reference-orchestration-only"
                : split === "held-out"
                  ? "small-held-out-pilot-not-release-benchmark"
                  : "model-development-evaluation",
            attempts,
            summary: summarize(attempts),
          },
        );
        console.log(`${configuration}/${task}/${trial}: ${result.state}`);
      }
  console.log(JSON.stringify(summarize(attempts), null, 2));
} finally {
  await store.close();
}
