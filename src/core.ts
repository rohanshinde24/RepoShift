import { createHash } from "node:crypto";
import {
  readdir,
  readFile,
  lstat,
  mkdir,
  writeFile,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(
  moduleDirectory,
  existsSync(path.join(moduleDirectory, "../package.json")) ? ".." : "../..",
);
export const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export async function tree(
  root: string,
  prefix = "",
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlinks are forbidden");
    if (entry.isDirectory()) Object.assign(out, await tree(root, relative));
    else {
      const stat = await lstat(path.join(root, relative));
      if (!stat.isFile() || stat.size > 256000)
        throw new Error("Unsupported file");
      out[relative] = await readFile(path.join(root, relative), "utf8");
    }
  }
  return out;
}
export function snapshot(files: Record<string, string>): string {
  return hash(
    JSON.stringify(
      Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}
export async function atomicJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}
export async function command(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    signal?: AbortSignal;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      signal: options.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (data: Buffer) => {
      output = (output + data.toString()).slice(-64000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timeout = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeout ?? 120000,
    );
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, output });
    });
  });
}
export async function git(cwd: string, ...args: string[]) {
  const r = await command("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (r.code) throw new Error(r.output);
  return r.output.trim();
}
