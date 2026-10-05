const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const phase = process.argv[2];
if (!["build", "visible", "hidden"].includes(phase))
  throw new Error("Unknown check");
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? files(path.join(dir, e.name))
        : e.name.endsWith(".ts")
          ? [path.join(dir, e.name)]
          : [],
    );
}
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  strict: true,
  skipLibCheck: true,
  rootDir: "/input",
  outDir: "/tmp/output",
  types: ["node"],
  typeRoots: ["/opt/reposhift/node_modules/@types"],
  noEmitOnError: true,
};
const program = ts.createProgram(files("/input"), options);
const result = program.emit();
const errors = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics];
if (errors.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => "/input",
      getCanonicalFileName: (f) => f,
      getNewLine: () => "\n",
    }),
  );
  process.exit(1);
}
if (phase !== "build") {
  const result = spawnSync(process.execPath, ["/checks/check.cjs"], {
    env: { OUTPUT: "/tmp/output" },
    stdio: "inherit",
    timeout: 90000,
  });
  process.exit(result.status ?? 1);
}
