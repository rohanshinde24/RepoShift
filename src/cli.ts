import { randomUUID } from "node:crypto";
import { Store } from "./store.js";
import { recipe } from "./recipes.js";
import { workOnce, execute } from "./workflow.js";
import { app } from "./api.js";
const [action, arg, provider = "reference"] = process.argv.slice(2);
const store = new Store();
try {
  await store.init();
  switch (action) {
    case "submit": {
      await recipe(arg ?? "");
      if (!["reference", "azure", "ollama"].includes(provider))
        throw new Error("Provider must be reference, azure, or ollama");
      const run = await store.submit(
        {
          recipe: arg!,
          provider: provider as "reference" | "azure" | "ollama",
        },
        randomUUID(),
      );
      console.log(JSON.stringify({ id: run.id, state: run.state }));
      break;
    }
    case "status":
      console.log(
        JSON.stringify(
          {
            run: await store.get(arg!),
            artifacts: await store.artifacts(arg!),
          },
          null,
          2,
        ),
      );
      break;
    case "cancel":
      await store.cancel(arg!);
      console.log("Cancellation requested");
      break;
    case "worker": {
      if (arg === "--once") {
        console.log(JSON.stringify(await workOnce(store)));
        break;
      }
      let stopped = false;
      process.on("SIGINT", () => {
        stopped = true;
      });
      process.on("SIGTERM", () => {
        stopped = true;
      });
      while (!stopped) {
        await workOnce(store);
        await new Promise((r) => setTimeout(r, 1000));
      }
      break;
    }
    case "demo": {
      await recipe(arg ?? "sdk-options");
      const run = await store.submit(
        {
          recipe: arg ?? "sdk-options",
          provider: provider as "reference" | "azure" | "ollama",
        },
        randomUUID(),
      );
      const claimed = await store.claim(randomUUID(), run.id);
      if (claimed) await execute(store, claimed);
      console.log(JSON.stringify(await store.get(run.id), null, 2));
      break;
    }
    case "serve": {
      const api = app(store, process.env.REPOSHIFT_API_TOKEN ?? "");
      await api.listen({
        port: Number(process.env.PORT ?? 3000),
        host: "127.0.0.1",
      });
      console.log("RepoShift API: http://127.0.0.1:3000");
      await new Promise<void>((resolve) => {
        for (const signal of ["SIGINT", "SIGTERM"])
          process.on(signal, () => resolve());
      });
      await api.close();
      break;
    }
    default:
      console.log(
        "Usage: npm run cli -- submit <recipe> [reference|azure|ollama]\n       npm run cli -- worker [--once]\n       npm run cli -- status <id>\n       npm run cli -- cancel <id>\n       npm run cli -- demo [recipe] [reference|azure|ollama]\n       npm start",
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await store.close();
}
