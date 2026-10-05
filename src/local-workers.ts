import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Store } from "./store.js";
export function spawnTaskWorker(
  store: Store,
  runId: string,
  leaseMs = 10000,
): ChildProcess {
  const source = import.meta.url.endsWith(".ts");
  return fork(
    fileURLToPath(
      new URL(
        source ? "./task-worker.ts" : "./task-worker.js",
        import.meta.url,
      ),
    ),
    [],
    {
      execArgv: source ? ["--import", "tsx"] : [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: {
        ...process.env,
        DATABASE_URL: store.url,
        REPOSHIFT_TASK_RUN_ID: runId,
        REPOSHIFT_TASK_LEASE_MS: String(leaseMs),
      },
    },
  );
}
export function workerPool(store: Store, runId: string, count = 2) {
  const workers = new Set<ChildProcess>();
  let stopped = false,
    restarts = 0;
  let lastError = "Worker processes exited";
  const launch = () => {
    if (stopped) return;
    const child = spawnTaskWorker(store, runId);
    workers.add(child);
    child.stderr?.on("data", (data) => {
      lastError = String(data).slice(-2000);
    });
    child.on("error", (error) => {
      lastError = error.message;
    });
    child.on("exit", () => {
      workers.delete(child);
      if (!stopped && restarts++ < 6) launch();
    });
  };
  for (let i = 0; i < count; i++) launch();
  const stop = async () => {
    stopped = true;
    await Promise.all(
      [...workers].map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null)
              return resolve();
            const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
            child.kill("SIGTERM");
          }),
      ),
    );
  };
  return Object.assign(stop, {
    check() {
      if (!stopped && workers.size === 0)
        throw new Error(`Local worker pool exhausted: ${lastError}`);
    },
  });
}
