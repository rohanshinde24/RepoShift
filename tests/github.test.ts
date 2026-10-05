import test from "node:test";
import assert from "node:assert/strict";
import { publish } from "../src/github.js";
test("publication reconciles a lost PR creation response without duplicating it", async () => {
  const fetch = globalThis.fetch;
  const repo = process.env.REPOSHIFT_GITHUB_REPOSITORY,
    token = process.env.GITHUB_TOKEN;
  process.env.REPOSHIFT_GITHUB_REPOSITORY = "operator/demo";
  process.env.GITHUB_TOKEN = "test-only";
  let pr: any;
  let branch: any;
  let creates = 0;
  globalThis.fetch = async (url, init) => {
    const route = new URL(String(url)).pathname.replace(
      "/repos/operator/demo",
      "",
    );
    const method = init?.method ?? "GET";
    let body: any;
    if (route === "/pulls" && method === "GET") body = pr ? [pr] : [];
    else if (route === "") body = { default_branch: "main" };
    else if (route === "/git/ref/heads/main")
      body = { object: { sha: "base" } };
    else if (route === "/git/commits/base")
      body = { tree: { sha: "base-tree" } };
    else if (route === "/contents/source.ts")
      body = {
        encoding: "base64",
        content: Buffer.from("before").toString("base64"),
      };
    else if (route === "/git/trees") body = { sha: "target-tree" };
    else if (route.startsWith("/git/ref/heads/")) {
      if (!branch) return new Response("{}", { status: 404 });
      body = branch;
    } else if (route === "/git/commits" && method === "POST")
      body = { sha: "target-commit" };
    else if (route === "/git/refs") {
      branch = { object: { sha: "target-commit" } };
      body = branch;
    } else if (route === "/git/commits/target-commit")
      body = { tree: { sha: "target-tree" } };
    else if (route === "/pulls" && method === "POST") {
      creates++;
      pr = { html_url: "https://github.com/operator/demo/pull/1" };
      throw new TypeError("Injected response loss");
    } else throw new Error(`Unexpected route ${method} ${route}`);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    await assert.rejects(
      publish(
        "id",
        "sdk-options",
        { "source.ts": "before" },
        { "source.ts": "after" },
        new AbortController().signal,
      ),
      /response loss/,
    );
    assert.equal(
      await publish(
        "id",
        "sdk-options",
        { "source.ts": "before" },
        { "source.ts": "after" },
        new AbortController().signal,
      ),
      "https://github.com/operator/demo/pull/1",
    );
    assert.equal(creates, 1);
  } finally {
    globalThis.fetch = fetch;
    if (repo === undefined) delete process.env.REPOSHIFT_GITHUB_REPOSITORY;
    else process.env.REPOSHIFT_GITHUB_REPOSITORY = repo;
    if (token === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = token;
  }
});
