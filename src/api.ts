import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { Store, type Input } from "./store.js";
import { recipeIds } from "./recipes.js";
import { validateSource } from "./source.js";
export function app(store: Store, token: string) {
  if (token.length < 24)
    throw new Error("REPOSHIFT_API_TOKEN must contain at least 24 characters");
  const api = Fastify({ bodyLimit: 16384 });
  api.addHook("onRequest", async (request, reply) => {
    const actual = Buffer.from(request.headers.authorization ?? ""),
      expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return reply.code(401).send({ error: "Unauthorized" });
  });
  api.post<{ Body: Input }>(
    "/runs",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["recipe", "provider"],
          properties: {
            repository: { type: "string", maxLength: 200 },
            baseRef: { type: "string", pattern: "^[0-9a-f]{40}$" },
            recipe: { type: "string", enum: recipeIds },
            provider: {
              type: "string",
              enum: ["reference", "azure", "ollama"],
            },
            goal: { type: "string", maxLength: 2000 },
            publish: { type: "boolean" },
            configuration: { type: "string", enum: ["A", "B", "C"] },
          },
        },
      },
    },
    async (request, reply) => {
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string")
        return reply
          .code(400)
          .send({ error: "Idempotency-Key header required" });
      validateSource(request.body);
      const run = await store.submit(request.body, key);
      return reply.code(202).send({ id: run.id, state: run.state });
    },
  );
  api.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
    const run = await store.get(request.params.id);
    if (!run) return reply.code(404).send({ error: "Unknown run" });
    return {
      run,
      artifacts: await store.artifacts(run.id),
      events: await store.events(run.id),
    };
  });
  api.post<{ Params: { id: string } }>(
    "/runs/:id/cancel",
    async (request, reply) => {
      if (!(await store.get(request.params.id)))
        return reply.code(404).send({ error: "Unknown run" });
      await store.cancel(request.params.id);
      return { requested: true };
    },
  );
  api.setErrorHandler((error, _request, reply) => {
    reply.code(400).send({
      error: error instanceof Error ? error.message : "Invalid request",
    });
  });
  return api;
}
