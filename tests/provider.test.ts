import test from "node:test";
import assert from "node:assert/strict";
import { propose } from "../src/provider.js";
import { recipe } from "../src/recipes.js";
test("paid calls fail before any network request unless explicitly enabled", async () => {
  const saved = process.env.REPOSHIFT_ALLOW_PAID,
    originalFetch = globalThis.fetch;
  delete process.env.REPOSHIFT_ALLOW_PAID;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unexpected network call");
  };
  try {
    await assert.rejects(
      propose({
        provider: "azure",
        recipe: await recipe("sdk-options"),
        files: {},
        allowed: [],
        signal: new AbortController().signal,
        reserve: async () => "unused",
        record: async () => {},
      }),
      /Paid model calls are disabled/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (saved === undefined) delete process.env.REPOSHIFT_ALLOW_PAID;
    else process.env.REPOSHIFT_ALLOW_PAID = saved;
  }
});
test("Azure rate limits retry within budget and record successful usage", async () => {
  const originalFetch = globalThis.fetch;
  const original = { ...process.env };
  process.env.REPOSHIFT_ALLOW_PAID = "1";
  let calls = 0,
    reservations = 0,
    records = 0;
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
  process.env.AZURE_OPENAI_API_KEY = "test";
  process.env.AZURE_OPENAI_DEPLOYMENT = "test";
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1)
      return new Response("{}", {
        status: 429,
        headers: { "retry-after": "0" },
      });
    const body = JSON.parse(init!.body as string);
    const request = JSON.parse(body.messages[1].content);
    return new Response(
      JSON.stringify({
        model: "test",
        usage: { prompt_tokens: 10, completion_tokens: 20 },
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
                      edits: [],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  };
  try {
    const patch = await propose({
      provider: "azure",
      recipe: await recipe("sdk-options"),
      files: { "src/file.ts": "source" },
      allowed: ["src/file.ts"],
      signal: new AbortController().signal,
      reserve: async (tokens) => {
        assert.ok(tokens > 8000);
        reservations++;
        return `mock-${reservations}`;
      },
      record: async (usage) => {
        assert.equal(usage.input + usage.output, 30);
        records++;
      },
    });
    assert.equal(patch.edits.length, 0);
    assert.equal(calls, 2);
    assert.equal(reservations, 2);
    assert.equal(records, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of [
      "REPOSHIFT_ALLOW_PAID",
      "AZURE_OPENAI_ENDPOINT",
      "AZURE_OPENAI_API_KEY",
      "AZURE_OPENAI_DEPLOYMENT",
    ]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
test("local provider uses loopback JSON schema and records model usage without paid opt-in", async () => {
  const originalFetch = globalThis.fetch;
  const paid = process.env.REPOSHIFT_ALLOW_PAID;
  const localModel = process.env.REPOSHIFT_OLLAMA_MODEL;
  delete process.env.REPOSHIFT_ALLOW_PAID;
  delete process.env.REPOSHIFT_OLLAMA_MODEL;
  let reserved = 0;
  let recorded = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.stream, false);
    assert.equal(body.format.additionalProperties, false);
    assert.deepEqual(body.format.properties.edits.items.properties.path.enum, [
      "src/file.ts",
    ]);
    assert.deepEqual(body.format.properties.base_hash.enum, [
      JSON.parse(body.messages[1].content).base_hash,
    ]);
    assert.equal(body.model, "qwen2.5:7b");
    const request = JSON.parse(body.messages[1].content);
    return new Response(
      JSON.stringify({
        model: "qwen2.5:7b",
        message: {
          content: JSON.stringify({
            base_hash: request.base_hash,
            edits: [],
          }),
        },
        prompt_eval_count: 12,
        eval_count: 6,
      }),
    );
  };
  try {
    const patch = await propose({
      provider: "ollama",
      recipe: await recipe("sdk-options"),
      files: { "src/file.ts": "source" },
      allowed: ["src/file.ts"],
      signal: new AbortController().signal,
      reserve: async (tokens) => {
        reserved++;
        assert.ok(tokens > 8000);
        return "local-reservation";
      },
      record: async (usage, id) => {
        recorded++;
        assert.equal(id, "local-reservation");
        assert.equal(usage.input + usage.output, 18);
      },
    });
    assert.equal(patch.edits.length, 0);
    assert.equal(reserved, 1);
    assert.equal(recorded, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (paid === undefined) delete process.env.REPOSHIFT_ALLOW_PAID;
    else process.env.REPOSHIFT_ALLOW_PAID = paid;
    if (localModel === undefined) delete process.env.REPOSHIFT_OLLAMA_MODEL;
    else process.env.REPOSHIFT_OLLAMA_MODEL = localModel;
  }
});
