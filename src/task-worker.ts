import path from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Store } from "./store.js";
import { TaskQueue } from "./task-queue.js";
import { ROOT, git } from "./core.js";
import { recipe } from "./recipes.js";
import { propose } from "./provider.js";
import { applyPatch } from "./patch.js";

const runId = process.env.REPOSHIFT_TASK_RUN_ID;
if (!runId) throw new Error("Worker requires REPOSHIFT_TASK_RUN_ID");
const store = new Store(),
  queue = new TaskQueue(
    store,
    Number(process.env.REPOSHIFT_TASK_LEASE_MS ?? 10000),
  );
const owner = `${process.pid}:${randomUUID()}`;
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
try {
  while (!stopped) {
    const parent = await store.get(runId);
    if (
      !parent ||
      ["COMPLETE", "FAILED", "CANCELLED"].includes(parent.state) ||
      parent.cancel_requested
    )
      break;
    const task = await queue.claim(runId, owner);
    if (!task) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    const controller = new AbortController();
    const timer = setInterval(
      () => queue.heartbeat(task).catch((e) => controller.abort(e)),
      Math.floor(queue.leaseMs / 3),
    );
    const root = path.join(ROOT, ".runs", runId, "tasks", randomUUID());
    try {
      process.send?.({
        type: "claimed",
        task: task.id,
        pid: process.pid,
        fence: task.fence,
      });
      const seed = path.join(root, "seed"),
        work = path.join(root, "work");
      await mkdir(seed, { recursive: true });
      for (const [file, content] of Object.entries(task.payload.files)) {
        if (
          path.isAbsolute(file) ||
          file.split("/").some((part) => ["..", ".git", ""].includes(part))
        )
          throw new Error("Invalid source path");
        await mkdir(path.dirname(path.join(seed, file)), { recursive: true });
        await writeFile(path.join(seed, file), content);
      }
      await git(seed, "init", "-b", "main");
      await git(seed, "config", "user.name", "RepoShift");
      await git(seed, "config", "user.email", "reposhift@localhost");
      await git(seed, "add", ".");
      await git(seed, "commit", "-m", "Task input");
      await git(seed, "worktree", "add", "--detach", work, "HEAD");
      const patch = await propose({
        provider: parent.input.provider,
        recipe: await recipe(task.payload.recipe),
        files: task.payload.files,
        allowed: task.payload.allowed,
        context: task.payload.context,
        diagnostics: task.payload.diagnostics,
        goal: parent.input.goal,
        signal: controller.signal,
        reserve: (tokens) =>
          store.reserveModelCall(runId, task.run_fence, tokens, {
            id: task.id,
            fence: task.fence,
            owner: task.lease_owner,
          }),
        record: (usage, id) => store.completeModelCall(id, usage),
      });
      await applyPatch(work, patch, task.payload.allowed);
      controller.signal.throwIfAborted();
      await queue.finish(task, patch);
      process.send?.({ type: "completed", task: task.id, pid: process.pid });
    } catch (error) {
      await queue.finish(task, null, String(error)).catch(() => {});
    } finally {
      clearInterval(timer);
      await rm(root, { recursive: true, force: true });
    }
  }
} finally {
  await store.close();
}
