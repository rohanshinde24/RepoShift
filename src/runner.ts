import path from "node:path";
import { randomUUID } from "node:crypto";
import { command } from "./core.js";
import { recipePath } from "./recipes.js";
export type Check = "build" | "visible" | "hidden";
export const sandboxFlags = [
  "--network",
  "none",
  "--read-only",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--pids-limit",
  "64",
  "--memory",
  "512m",
  "--cpus",
  "1",
  "--user",
  "1000:1000",
  "--tmpfs",
  "/tmp:rw,noexec,nosuid,size=128m",
];
export async function resolveImage() {
  const result = await command("docker", [
    "image",
    "inspect",
    process.env.REPOSHIFT_RUNNER_IMAGE ?? "reposhift-runner:dev",
    "--format",
    "{{.Id}}",
  ]);
  if (result.code || !/^sha256:[a-f0-9]{64}$/.test(result.output.trim()))
    throw new Error("Build the RepoShift runner image first");
  return result.output.trim();
}
export async function check(
  root: string,
  id: string,
  phase: Check,
  signal?: AbortSignal,
  pinnedImage?: string,
) {
  const name = "reposhift-" + randomUUID();
  const image =
    pinnedImage ?? process.env.REPOSHIFT_RUNNER_IMAGE ?? "reposhift-runner:dev";
  const args = [
    "run",
    "--rm",
    "--name",
    name,
    ...sandboxFlags,
    "--mount",
    `type=bind,source=${path.resolve(root)},target=/input,readonly`,
  ];
  if (phase !== "build")
    args.push(
      "--mount",
      `type=bind,source=${path.join(recipePath(id), phase + ".cjs")},target=/checks/check.cjs,readonly`,
    );
  args.push(image, phase);
  try {
    return await command("docker", args, { signal, timeout: 120000 });
  } finally {
    await command("docker", ["rm", "-f", name], { timeout: 15000 }).catch(
      () => {},
    );
  }
}
