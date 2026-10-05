import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { Store } from "../../src/store.js";
import { TaskQueue } from "../../src/task-queue.js";
import { spawnTaskWorker } from "../../src/local-workers.js";
import { recipePath, reference } from "../../src/recipes.js";
import { tree } from "../../src/core.js";
import { mockAzure } from "./mock-azure.js";

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
test(
  "Azure protocol double across process loss and cancellation",
  { timeout: 60000 },
  async (t) => {
    const admin = new Store(),
      schema = "test_" + randomUUID().replaceAll("-", "");
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(admin.url);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const store = new Store(url.toString());
    await store.init();
    const queue = new TaskQueue(store, 1000),
      files = await tree(path.join(recipePath("sdk-options"), "base"));
    const values = await reference("sdk-options");
    const children: ChildProcess[] = [];
    const saved = {
      paid: process.env.REPOSHIFT_ALLOW_PAID,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      key: process.env.AZURE_OPENAI_API_KEY,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
      ca: process.env.NODE_EXTRA_CA_CERTS,
    };
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseCancelled: () => void = () => {};
    const heldCancelled = new Promise<void>((resolve) => {
      releaseCancelled = resolve;
    });
    const server = await mockAzure(async (body, call) => {
      if (call === 1) await held;
      if (call === 3) await heldCancelled;
      const input = JSON.parse(body.messages[1].content);
      return {
        body: {
          model: "local-double",
          usage: { prompt_tokens: 100, completion_tokens: 100 },
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "propose_patch",
                      arguments: JSON.stringify({
                        base_hash: input.base_hash,
                        edits: [
                          {
                            path: "src/retail.ts",
                            content: values["src/retail.ts"],
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
      };
    });
    process.env.REPOSHIFT_ALLOW_PAID = "1";
    process.env.AZURE_OPENAI_ENDPOINT = server.endpoint;
    process.env.AZURE_OPENAI_API_KEY = "local-test-only";
    process.env.AZURE_OPENAI_DEPLOYMENT = "local-double";
    process.env.NODE_EXTRA_CA_CERTS = server.ca;
    async function parent() {
      const submitted = await store.submit(
        { recipe: "sdk-options", provider: "azure" },
        randomUUID(),
      );
      const run = (await store.claim("coordinator", submitted.id))!;
      await store.save(run, "EXECUTE");
      return run;
    }
    try {
      await t.test(
        "killed worker leaves a charged reservation and replacement completes safely",
        async () => {
          const run = await parent();
          await queue.enqueue(run, "migrate", {
            recipe: "sdk-options",
            files,
            allowed: ["src/retail.ts"],
          });
          const first = spawnTaskWorker(store, run.id, 1000);
          children.push(first);
          await until(async () =>
            server.calls() === 1 &&
            (await store.modelAccounting(run.id)).requests === 1
              ? true
              : undefined,
          );
          const old = (await queue.get(run.id, "migrate"))!;
          await stop(first);
          release();
          const second = spawnTaskWorker(store, run.id, 1000);
          children.push(second);
          const done = await until(async () => {
            const row = await queue.get(run.id, "migrate");
            return row?.state === "SUCCEEDED" ? row : undefined;
          });
          assert.equal(done.attempts, 2);
          assert.notEqual(done.lease_owner, old.lease_owner);
          assert.equal(done.result?.edits[0]?.path, "src/retail.ts");
          await assert.rejects(queue.finish(old, done.result), /lease lost/i);
          const totals = await store.modelAccounting(run.id);
          assert.equal(totals.requests, 2);
          assert.equal(totals.spent, 200);
          assert.ok(totals.pending > 0);
          await store.save(run, "COMPLETE");
          assert.equal(run.checkpoint.requests, 2);
          assert.equal(run.checkpoint.tokens, 200);
          await stop(second);
        },
      );
      await t.test("cancelled run rejects new reservations", async () => {
        const run = await parent();
        await queue.enqueue(run, "cancel", {
          recipe: "sdk-options",
          files,
          allowed: ["src/retail.ts"],
        });
        const task = (await queue.claim(run.id, "cancel-worker"))!;
        await store.cancel(run.id);
        await assert.rejects(
          store.reserveModelCall(run.id, run.fence, 100, {
            id: task.id,
            fence: task.fence,
            owner: task.lease_owner,
          }),
          /cancelled/,
        );
        await assert.rejects(
          queue.finish(task, { base_hash: "x", edits: [] }),
          /cancelled/,
        );
        await store.save(run, "CANCELLED");
      });
      await t.test(
        "cancellation interrupts an in-flight model request",
        async () => {
          const run = await parent();
          await queue.enqueue(run, "in-flight", {
            recipe: "sdk-options",
            files,
            allowed: ["src/retail.ts"],
          });
          const worker = spawnTaskWorker(store, run.id, 1000);
          children.push(worker);
          await until(async () =>
            server.calls() === 3 &&
            (await store.modelAccounting(run.id)).requests === 1
              ? true
              : undefined,
          );
          await store.cancel(run.id);
          await until(async () =>
            worker.exitCode !== null || worker.signalCode !== null
              ? true
              : undefined,
          );
          releaseCancelled();
          assert.notEqual(
            (await queue.get(run.id, "in-flight"))?.state,
            "SUCCEEDED",
          );
          const accounting = await store.modelAccounting(run.id);
          assert.equal(accounting.requests, 1);
          assert.equal(accounting.spent, 0);
          assert.ok(accounting.pending > 0);
          await store.save(run, "CANCELLED");
        },
      );
      await t.test(
        "concurrent reservations share the same token ceiling",
        async () => {
          const run = await parent();
          for (const id of ["a", "b"])
            await queue.enqueue(run, id, {
              recipe: "sdk-options",
              files,
              allowed: ["src/retail.ts"],
            });
          const a = (await queue.claim(run.id, "a"))!,
            b = (await queue.claim(run.id, "b"))!;
          const tasks = [a, b, a, b].map((task) =>
            store.reserveModelCall(run.id, run.fence, 30000, {
              id: task.id,
              fence: task.fence,
              owner: task.lease_owner,
            }),
          );
          const outcome = await Promise.allSettled(tasks);
          assert.equal(
            outcome.filter((x) => x.status === "fulfilled").length,
            3,
          );
          assert.equal(
            outcome.filter((x) => x.status === "rejected").length,
            1,
          );
          const id = (
            outcome.find(
              (x) => x.status === "fulfilled",
            ) as PromiseFulfilledResult<string>
          ).value;
          await store.completeModelCall(id, {
            input: 100,
            output: 100,
            cached: 0,
            model: "double",
            requestId: null,
          });
          const accounting = await store.modelAccounting(run.id);
          assert.equal(accounting.requests, 3);
          assert.equal(accounting.spent, 200);
          assert.equal(accounting.pending, 60000);
          await store.save(run, "FAILED");
          assert.equal(run.checkpoint.tokens, 200);
          assert.equal(run.checkpoint.reservedTokens, 60000);
        },
      );
    } finally {
      release();
      releaseCancelled();
      await Promise.all(children.map(stop));
      await server.close();
      for (const [name, value] of Object.entries({
        REPOSHIFT_ALLOW_PAID: saved.paid,
        AZURE_OPENAI_ENDPOINT: saved.endpoint,
        AZURE_OPENAI_API_KEY: saved.key,
        AZURE_OPENAI_DEPLOYMENT: saved.deployment,
        NODE_EXTRA_CA_CERTS: saved.ca,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await store.close();
      await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    }
  },
);
