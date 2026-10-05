import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { Store } from "../../src/store.js";
import { TaskQueue } from "../../src/task-queue.js";
import { spawnTaskWorker } from "../../src/local-workers.js";
import { recipePath } from "../../src/recipes.js";
import { tree, atomicJson, ROOT } from "../../src/core.js";

async function until<T>(
  read: () => Promise<T | undefined>,
  ms = 15000,
): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await read();
    if (result !== undefined) return result;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for worker");
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, "exit");
  child.kill("SIGKILL");
  await done;
}
test("independent local task workers", { timeout: 60000 }, async (t) => {
  const admin = new Store(),
    schema = "test_" + randomUUID().replaceAll("-", "");
  await admin.pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(admin.url);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const store = new Store(url.toString());
  await store.init();
  const queue = new TaskQueue(store, 1000);
  const files = await tree(path.join(recipePath("sdk-options"), "base"));
  const payload = {
    recipe: "sdk-options",
    files,
    allowed: ["src/retail.ts", "src/wholesale.ts"],
  };
  const evidence: unknown[] = [];
  const children: ChildProcess[] = [];
  async function parent() {
    const submitted = await store.submit(
      { recipe: "sdk-options", provider: "reference" },
      randomUUID(),
    );
    const run = (await store.claim("coordinator", submitted.id))!;
    await store.save(run, "EXECUTE");
    return run;
  }
  try {
    await t.test(
      "SIGKILL after claim is recovered by another process after lease expiry",
      async () => {
        const run = await parent();
        await queue.enqueue(run, "migration", payload);
        const first = spawnTaskWorker(store, run.id, 1000);
        children.push(first);
        const claimed = await new Promise<any>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("No claim message")),
            10000,
          );
          first.once("message", (message) => {
            first.kill("SIGSTOP");
            clearTimeout(timer);
            resolve(message);
          });
          first.once("error", reject);
        });
        const old = (await queue.get(run.id, "migration"))!;
        await stop(first);
        assert.equal(old.state, "RUNNING");
        const second = spawnTaskWorker(store, run.id, 1000);
        children.push(second);
        const result = await until(async () => {
          const row = await queue.get(run.id, "migration");
          return row?.state === "SUCCEEDED" ? row : undefined;
        });
        assert.equal(result.attempts, 2);
        assert.notEqual(result.lease_owner, old.lease_owner);
        assert.equal(result.result?.edits.length, 2);
        await assert.rejects(queue.finish(old, result.result), /lease lost/i);
        const events = await store.events(run.id);
        assert.equal(
          events.filter((e) => e.state === "TASK_SUCCEEDED").length,
          1,
        );
        evidence.push({
          case: "worker-sigkill",
          firstPid: claimed.pid,
          replacementOwner: result.lease_owner,
          attempts: result.attempts,
          acceptedResults: 1,
          events,
        });
        await store.save(run, "COMPLETE");
        await stop(second);
      },
    );
    await t.test(
      "concurrent claimants respect the two-task cap and duplicate enqueue is idempotent",
      async () => {
        const run = await parent();
        for (const id of ["a", "b", "c"]) await queue.enqueue(run, id, payload);
        await queue.enqueue(run, "a", payload);
        const claims = await Promise.all(
          [1, 2, 3, 4].map((i) => queue.claim(run.id, `worker-${i}`)),
        );
        const live = claims.filter((x) => x !== undefined);
        assert.ok(live.length <= 2);
        // SKIP LOCKED may return early while another claimant holds the run lock.
        while (
          (
            await store.pool.query(
              "SELECT count(*) FROM tasks WHERE run_id=$1 AND state='RUNNING'",
              [run.id],
            )
          ).rows[0].count !== "2"
        )
          assert.ok(await queue.claim(run.id, "fill"));
        assert.equal(await queue.claim(run.id, "over-cap"), undefined);
        assert.equal(
          (
            await store.pool.query(
              "SELECT count(*) FROM tasks WHERE run_id=$1",
              [run.id],
            )
          ).rows[0].count,
          "3",
        );
        evidence.push({
          case: "concurrency-cap",
          maximumActive: 2,
          uniqueTasks: 3,
        });
        await store.save(run, "FAILED");
      },
    );
    await t.test(
      "cancellation rejects a running task result and prevents new claims",
      async () => {
        const run = await parent();
        await queue.enqueue(run, "a", payload);
        const task = (await queue.claim(run.id, "late-worker"))!;
        await store.cancel(run.id);
        await assert.rejects(
          queue.finish(task, { base_hash: "unused", edits: [] }),
          /cancelled/,
        );
        assert.equal(await queue.claim(run.id, "other"), undefined);
        await store.save(run, "CANCELLED");
        evidence.push({ case: "cancel-late-result", accepted: false });
      },
    );
    await t.test(
      "coordinator replacement invalidates old task ownership",
      async () => {
        const run = await parent();
        await queue.enqueue(run, "a", payload);
        const old = (await queue.claim(run.id, "old-worker"))!;
        await store.pool.query(
          "UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=$1",
          [run.id],
        );
        const replacement = (await store.claim("new-coordinator", run.id))!;
        await store.save(replacement, "EXECUTE");
        await queue.enqueue(replacement, "a", payload);
        await assert.rejects(
          queue.finish(old, { base_hash: "unused", edits: [] }),
          /lease lost/,
        );
        const next = (await queue.claim(run.id, "new-worker"))!;
        assert.equal(next.run_fence, replacement.fence);
        assert.ok(next.fence > old.fence);
        await store.save(replacement, "FAILED");
        evidence.push({
          case: "coordinator-fencing",
          oldFence: old.run_fence,
          newFence: next.run_fence,
        });
      },
    );
    await t.test("repeated task loss stops after three claims", async () => {
      const run = await parent();
      await queue.enqueue(run, "a", payload);
      for (let i = 0; i < 3; i++) {
        const task = await queue.claim(run.id, "failing");
        assert.equal(task?.attempts, i + 1);
        await store.pool.query(
          "UPDATE tasks SET lease_until=now()-interval '1 second' WHERE run_id=$1",
          [run.id],
        );
      }
      assert.equal(await queue.claim(run.id, "fourth"), undefined);
      assert.equal((await queue.get(run.id, "a"))?.state, "FAILED");
      await store.save(run, "FAILED");
      evidence.push({ case: "bounded-task-retry", claims: 3 });
    });
    await atomicJson(path.join(ROOT, "reports/local/worker-reliability.json"), {
      kind: "local-process-tests-not-model-evaluation",
      at: new Date().toISOString(),
      scenarios: evidence,
    });
  } finally {
    await Promise.all(children.map(stop));
    await store.close();
    await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  }
});
