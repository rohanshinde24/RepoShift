import https from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const run = promisify(execFile);
export async function mockAzure(
  handler: (
    body: any,
    call: number,
  ) => Promise<{
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  }>,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reposhift-tls-"));
  const key = path.join(dir, "key.pem"),
    cert = path.join(dir, "cert.pem");
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-days",
    "1",
  ]);
  let calls = 0;
  const server = https.createServer(
    { key: await readFile(key), cert: await readFile(cert) },
    async (request, response) => {
      try {
        if (
          request.url !== "/openai/v1/chat/completions" ||
          request.method !== "POST"
        )
          throw new Error("Unexpected request");
        let data = "";
        for await (const chunk of request) data += chunk.toString();
        const result = await handler(JSON.parse(data), ++calls);
        response.writeHead(result.status ?? 200, {
          "Content-Type": "application/json",
          ...result.headers,
        });
        response.end(JSON.stringify(result.body ?? {}));
      } catch (error) {
        response.writeHead(500);
        response.end(JSON.stringify({ error: String(error) }));
      }
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Mock Azure did not listen");
  return {
    endpoint: `https://127.0.0.1:${address.port}`,
    ca: cert,
    calls: () => calls,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
