import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Store, type Run } from "./store.js";
import { ROOT, git, tree, snapshot, atomicJson, command } from "./core.js";
import { recipe } from "./recipes.js";
import { analyze, plan, targetedContext } from "./analysis.js";
import { applyPatch, type Patch } from "./patch.js";
import { check, resolveImage } from "./runner.js";
import { verify, migrationAssertions } from "./verification.js";
import { publish } from "./github.js";
import { prepareSource } from "./source.js";
import { TaskQueue } from "./task-queue.js";
import { workerPool } from "./local-workers.js";
export async function execute(store: Store, run: Run, external?: AbortSignal) {
  const controller = new AbortController();
  const remaining = 900000 - (Date.now() - new Date(run.created_at).getTime());
  const timer = setTimeout(
    () => controller.abort(new Error("Run deadline exceeded")),
    Math.max(1, remaining),
  );
  const signal = external
    ? AbortSignal.any([controller.signal, external])
    : controller.signal;
  const heartbeat = setInterval(() => {
    store
      .heartbeat(run)
      .then((cancel) => {
        if (cancel) controller.abort(new Error("Cancelled"));
      })
      .catch((e) => controller.abort(e));
  }, 1000);
  const baseDir = path.join(ROOT, ".runs", run.id, `attempt-${run.fence}`),
    checkout = path.join(baseDir, "checkout");
  let stopWorkers: ReturnType<typeof workerPool> | undefined;
  const queue = new TaskQueue(store);
  const transition = async (state: string, detail: unknown = {}) => {
    signal.throwIfAborted();
    await store.save(run, state, detail);
  };
  try {
    if (run.cancel_requested) throw new Error("Cancelled");
    if (
      run.input.provider === "azure" &&
      process.env.REPOSHIFT_ALLOW_PAID !== "1"
    )
      throw new Error("Paid model calls are disabled");
    signal.throwIfAborted();
    const r = await recipe(run.input.recipe);
    const image = run.checkpoint.image ?? (await resolveImage());
    run.checkpoint.image = image;
    await mkdir(checkout, { recursive: true });
    await prepareSource(run.input, r, checkout);
    const before = await tree(checkout);
    if (migrationAssertions(before, r))
      throw new Error("Requested migration is already complete");
    await git(checkout, "init", "-b", "main");
    await git(checkout, "config", "user.name", "RepoShift");
    await git(checkout, "config", "user.email", "reposhift@localhost");
    await git(checkout, "add", ".");
    await git(checkout, "commit", "--allow-empty", "-m", "Run source snapshot");
    const baseSha = await git(checkout, "rev-parse", "HEAD");
    await store.artifact(run, "base", {
      snapshot: snapshot(before),
      sha: baseSha,
      recipe: r.id,
      version: r.version,
      provider: run.input.provider,
      repository: run.input.repository ?? null,
      sourceCommit: run.input.baseRef ?? null,
    });
    await transition("ANALYZE");
    if (run.checkpoint.patches.length === 0) {
      for (const phase of ["build", "visible"] as const) {
        const baseline = await check(checkout, r.id, phase, signal, image);
        await store.artifact(run, `baseline-${phase}`, baseline);
        if (baseline.code) throw new Error("Baseline repository checks failed");
      }
    }
    const graph = await analyze(checkout);
    await store.artifact(run, "graph", graph);
    // Checkpoint replay is trusted stored output; model-supplied patches were validated before storage.
    for (const saved of run.checkpoint.patches) {
      await applyPatch(
        checkout,
        { ...saved.patch, base_hash: snapshot(await tree(checkout)) },
        r.allowedFiles,
      );
    }
    await git(checkout, "add", ".");
    await git(
      checkout,
      "commit",
      "--allow-empty",
      "-m",
      "Restore accepted checkpoint",
    );
    await transition("PLAN");
    const tasks =
      run.input.configuration === "A"
        ? [{ id: "flat", files: r.allowedFiles, dependsOn: [] }]
        : plan(graph, r);
    await store.artifact(run, "plan", tasks);
    await transition("EXECUTE");
    const completed = new Set(
      run.checkpoint.patches
        .filter((p) => !p.task.startsWith("repair-"))
        .map((p) => p.task),
    );
    stopWorkers = workerPool(
      store,
      run.id,
      run.input.configuration === "A" ? 1 : 2,
    );
    const queuedPatch = async (
      id: string,
      files: Record<string, string>,
      allowed: string[],
      context?: Record<string, string>,
      diagnostics?: string,
    ): Promise<Patch> => {
      await queue.enqueue(run, id, {
        recipe: r.id,
        files,
        allowed,
        context,
        diagnostics,
      });
      for (;;) {
        signal.throwIfAborted();
        stopWorkers?.check();
        const pending = await queue.get(run.id, id);
        if (pending?.run_fence !== run.fence)
          throw new Error("Task belongs to stale coordinator");
        if (pending.state === "FAILED")
          throw new Error(pending.error ?? "Task failed");
        if (pending.state === "SUCCEEDED" && pending.result)
          return pending.result;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    while (tasks.some((t) => !completed.has(t.id))) {
      signal.throwIfAborted();
      const ready = tasks
        .filter(
          (t) =>
            !completed.has(t.id) && t.dependsOn.every((d) => completed.has(d)),
        )
        .slice(0, run.input.configuration === "A" ? 1 : 2);
      if (!ready.length) throw new Error("DAG cannot make progress");
      const commit = await git(checkout, "rev-parse", "HEAD");
      // Worktree setup mutates the common Git metadata and is intentionally sequential.
      for (const task of ready)
        await git(
          checkout,
          "worktree",
          "add",
          "--detach",
          path.join(baseDir, task.id),
          commit,
        );
      const settled = await Promise.allSettled(
        ready.map(async (task) => {
          const work = path.join(baseDir, task.id),
            files = await tree(work);
          const patch = await queuedPatch(
            task.id,
            files,
            task.files,
            run.input.configuration === "A"
              ? files
              : targetedContext(graph, files, task.files),
          );
          await applyPatch(work, patch, task.files);
          return { task, patch, files };
        }),
      );
      const outputs = settled.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      for (const { task, patch, files } of outputs) {
        signal.throwIfAborted();
        const current = await tree(checkout);
        for (const edit of patch.edits)
          if (current[edit.path] !== files[edit.path])
            throw new Error("Integration conflict");
        // Persist accepted output first, then integrate; restart replays this checkpoint.
        run.checkpoint.patches.push({ task: task.id, patch });
        await store.save(run, "EXECUTE", { task: task.id });
        await applyPatch(
          checkout,
          { ...patch, base_hash: snapshot(current) },
          task.files,
        );
        await git(checkout, "add", ".");
        await git(checkout, "commit", "--allow-empty", "-m", task.id);
        completed.add(task.id);
      }
    }
    for (;;) {
      await transition("BUILD");
      const build = await check(checkout, r.id, "build", signal, image);
      await store.artifact(run, `build-${run.checkpoint.repairs}`, build);
      let visible = { code: 1, output: "" };
      if (build.code === 0) {
        await transition("TEST");
        visible = await check(checkout, r.id, "visible", signal, image);
        await store.artifact(run, `visible-${run.checkpoint.repairs}`, visible);
      }
      if (build.code === 0 && visible.code === 0) break;
      if (
        run.checkpoint.repairs >=
        (run.input.configuration && run.input.configuration !== "C" ? 0 : 3)
      )
        throw new Error("Repair budget exhausted");
      run.checkpoint.repairs++;
      await transition("REPAIR");
      const patch: Patch = await queuedPatch(
        `repair-${run.checkpoint.repairs}`,
        await tree(checkout),
        r.allowedFiles,
        undefined,
        (build.output + visible.output).slice(-16000),
      );
      // Validate on an isolated worktree before persisting the repair.
      const repairDir = path.join(baseDir, `repair-${run.checkpoint.repairs}`);
      await git(checkout, "worktree", "add", "--detach", repairDir, "HEAD");
      await applyPatch(repairDir, patch, r.allowedFiles);
      run.checkpoint.patches.push({
        task: `repair-${run.checkpoint.repairs}`,
        patch,
      });
      await store.save(run, "REPAIR");
      await applyPatch(checkout, patch, r.allowedFiles);
      await git(checkout, "add", ".");
      await git(checkout, "commit", "--allow-empty", "-m", "Repair");
      await store.artifact(run, "graph", await analyze(checkout));
    }
    await stopWorkers?.();
    stopWorkers = undefined;
    await transition("VERIFY");
    const verification = await verify(checkout, before, r, signal, image);
    run.checkpoint.verification = verification;
    await store.artifact(run, "verification", verification);
    if (!verification.passed)
      throw new Error("Independent verification failed");
    run.checkpoint.commit = await git(checkout, "rev-parse", "HEAD");
    const diff = await git(checkout, "diff", baseSha, "HEAD");
    await store.artifact(run, "patch", diff);
    if (run.input.publish) {
      await transition("PUBLISH");
      await store.pool.query(
        "INSERT INTO publish_outbox(run_id,branch) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [run.id, `reposhift/${run.id}`],
      );
      let url: string | undefined;
      for (let retry = 0; retry < 3; retry++) {
        signal.throwIfAborted();
        try {
          url = await publish(
            run.id,
            r.id,
            before,
            await tree(checkout),
            signal,
          );
          break;
        } catch (e) {
          if (retry === 2) throw e;
        }
      }
      await store.artifact(run, "pull_request", url);
      await store.pool.query(
        "UPDATE publish_outbox SET pr_url=$2 WHERE run_id=$1",
        [run.id, url],
      );
    }
    await transition("COMPLETE");
  } catch (error) {
    const latest = await store.get(run.id);
    run.error = String(error).slice(0, 2000);
    if (latest?.fence === run.fence)
      await store
        .save(run, latest.cancel_requested ? "CANCELLED" : "FAILED")
        .catch(() => {});
  } finally {
    controller.abort();
    await stopWorkers?.();
    clearInterval(heartbeat);
    clearTimeout(timer);
    await command("git", ["-C", checkout, "worktree", "prune"]).catch(() => {});
  }
  const latest = await store.get(run.id);
  await atomicJson(path.join(ROOT, ".runs", run.id, "report.json"), {
    run: latest,
    artifacts: await store.artifacts(run.id),
    events: await store.events(run.id),
  });
  return latest;
}
export async function workOnce(store: Store) {
  const run = await store.claim(randomUUID());
  if (!run) return undefined;
  return execute(store, run);
}
