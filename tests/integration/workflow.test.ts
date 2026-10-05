import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../../src/store.js";
import { execute } from "../../src/workflow.js";
import { reference } from "../../src/recipes.js";
import { app } from "../../src/api.js";
import { mockAzure } from "./mock-azure.js";

test("durable workflow integration", { timeout: 300000 }, async (t) => {
  const admin = new Store();
  const schema = "test_" + randomUUID().replaceAll("-", "");
  await admin.pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(
    process.env.DATABASE_URL ??
      "postgres://reposhift:reposhift@127.0.0.1:55432/reposhift",
  );
  url.searchParams.set("options", `-c search_path=${schema}`);
  const store = new Store(url.toString());
  await store.init();
  try {
    await t.test(
      "duplicate submissions are deduplicated and conflicting keys rejected",
      async () => {
        const input = { recipe: "sdk-options", provider: "reference" as const };
        const first = await store.submit(input, "same");
        const again = await store.submit(input, "same");
        assert.equal(first.id, again.id);
        await assert.rejects(
          store.submit({ ...input, recipe: "fs-promises" }, "same"),
          /conflicts/,
        );
        await store.cancel(first.id);
        const run = (await store.claim("cancel-test"))!;
        await execute(store, run);
        assert.equal((await store.get(first.id))!.state, "CANCELLED");
      },
    );
    await t.test(
      "expired worker is fenced after another worker claims its run",
      async () => {
        await store.submit(
          { recipe: "sdk-options", provider: "reference" },
          randomUUID(),
        );
        const old = (await store.claim("old-worker"))!;
        await store.pool.query(
          "UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=$1",
          [old.id],
        );
        const fresh = (await store.claim("new-worker"))!;
        assert.equal(fresh.id, old.id);
        await assert.rejects(store.save(old, "EXECUTE"), /Lease lost/);
        await assert.rejects(
          store.artifact(old, "bad", "late result"),
          /Lease lost/,
        );
        await store.save(fresh, "FAILED");
      },
    );
    for (const recipe of ["sdk-options", "fs-promises"])
      await t.test(
        `${recipe}: reference patch passes isolated full workflow`,
        async () => {
          const submitted = await store.submit(
            { recipe, provider: "reference" },
            randomUUID(),
          );
          const claimed = (await store.claim("integration"))!;
          assert.equal(claimed.id, submitted.id);
          const result = await execute(store, claimed);
          assert.equal(result?.state, "COMPLETE", result?.error ?? "");
          assert.equal(result?.checkpoint.requests, 0);
          assert.equal((result?.checkpoint.verification as any).passed, true);
          const events = await store.events(submitted.id);
          for (const state of [
            "ANALYZE",
            "PLAN",
            "EXECUTE",
            "BUILD",
            "TEST",
            "VERIFY",
            "COMPLETE",
          ])
            assert.ok(events.some((e) => e.state === state));
        },
      );
    await t.test(
      "stored task output survives worker loss and resumes from checkpoint",
      async () => {
        const submitted = await store.submit(
          { recipe: "sdk-options", provider: "reference" },
          randomUUID(),
        );
        const old = (await store.claim("crashed"))!;
        const values = await reference("sdk-options");
        old.checkpoint.patches = [
          {
            task: "task-0",
            patch: {
              base_hash: "already-validated",
              edits: [
                { path: "src/retail.ts", content: values["src/retail.ts"]! },
              ],
            },
          },
        ];
        await store.save(old, "EXECUTE");
        await store.pool.query(
          "UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=$1",
          [old.id],
        );
        const recovered = (await store.claim("replacement"))!;
        const result = await execute(store, recovered);
        assert.equal(result?.id, submitted.id);
        assert.equal(result?.state, "COMPLETE", result?.error ?? "");
        assert.equal(
          result?.checkpoint.patches.filter((p) => p.task === "task-0").length,
          1,
        );
      },
    );
    await t.test(
      "Azure workers share durable request accounting and repair compiler errors",
      async () => {
        let repairs = 0,
          rateLimits = 0;
        const server = await mockAzure(async (body, call) => {
          assert.equal(body.parallel_tool_calls, false);
          assert.equal(body.tools[0].function.strict, true);
          if (call === 1) {
            rateLimits++;
            return { status: 429, headers: { "retry-after": "0" } };
          }
          const request = JSON.parse(body.messages[1].content);
          const values = await reference("sdk-options");
          const edits = Object.entries(values)
            .filter(([file]) => request.allowed.includes(file))
            .map(([file, content]) => ({
              path: file,
              content:
                !request.diagnostics && file.endsWith("wholesale.ts")
                  ? content.replace(
                      "{amount, currency, discount}",
                      '{amount, currency, discount: "invalid"}',
                    )
                  : content,
            }));
          if (request.diagnostics) repairs++;
          return {
            body: {
              model: "protocol-double",
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
                            base_hash: request.base_hash,
                            edits,
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
        const saved = {
          paid: process.env.REPOSHIFT_ALLOW_PAID,
          endpoint: process.env.AZURE_OPENAI_ENDPOINT,
          key: process.env.AZURE_OPENAI_API_KEY,
          deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
          ca: process.env.NODE_EXTRA_CA_CERTS,
        };
        process.env.REPOSHIFT_ALLOW_PAID = "1";
        process.env.AZURE_OPENAI_ENDPOINT = server.endpoint;
        process.env.AZURE_OPENAI_API_KEY = "local-test-only";
        process.env.AZURE_OPENAI_DEPLOYMENT = "protocol-double";
        process.env.NODE_EXTRA_CA_CERTS = server.ca;
        try {
          const submitted = await store.submit(
            { recipe: "sdk-options", provider: "azure" },
            randomUUID(),
          );
          const result = await execute(
            store,
            (await store.claim("azure-coordinator", submitted.id))!,
          );
          assert.equal(result?.state, "COMPLETE", result?.error ?? "");
          assert.equal(repairs, 1);
          assert.equal(rateLimits, 1);
          assert.equal(result?.checkpoint.repairs, 1);
          assert.equal(result?.checkpoint.requests, server.calls());
          assert.equal(result?.checkpoint.tokens, (server.calls() - 1) * 200);
          assert.ok((result?.checkpoint.reservedTokens ?? 0) > 0);
          const events = await store.events(submitted.id);
          const workers = new Set(
            events
              .filter((e) => e.state === "TASK_CLAIMED")
              .map((e) => e.detail.worker),
          );
          assert.ok(workers.size >= 1);
          assert.ok(events.some((e) => e.state === "MODEL_USAGE"));
        } finally {
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
        }
      },
    );
    await t.test(
      "API authenticates, validates recipes, and exposes cancellation",
      async () => {
        const token = "integration-test-operator-token";
        const api = app(store, token);
        try {
          assert.equal(
            (await api.inject({ method: "POST", url: "/runs", payload: {} }))
              .statusCode,
            401,
          );
          const headers = {
            authorization: `Bearer ${token}`,
            "idempotency-key": randomUUID(),
          };
          assert.equal(
            (
              await api.inject({
                method: "POST",
                url: "/runs",
                headers,
                payload: { recipe: "unknown", provider: "reference" },
              })
            ).statusCode,
            400,
          );
          const response = await api.inject({
            method: "POST",
            url: "/runs",
            headers,
            payload: { recipe: "sdk-options", provider: "reference" },
          });
          assert.equal(response.statusCode, 202);
          const id = response.json().id;
          assert.equal(
            (
              await api.inject({
                method: "POST",
                url: `/runs/${id}/cancel`,
                headers,
              })
            ).statusCode,
            200,
          );
          assert.equal((await store.get(id))!.cancel_requested, true);
        } finally {
          await api.close();
        }
      },
    );
  } finally {
    await store.close();
    await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  }
});
