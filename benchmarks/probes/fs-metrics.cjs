const fs = require("node:fs");
const { metrics } = require(process.env.OUTPUT + "/src/metrics.js");

async function observe(action) {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, name: error.name, code: error.code ?? null };
  }
}

(async () => {
  const path = "/tmp/probe-metrics.txt";
  const cases = [];
  for (const [id, content] of [
    ["standard", "1 3 8"],
    ["fractional", "1.5 2.5"],
    ["empty", ""],
    ["invalid", "4 bad"],
  ]) {
    fs.writeFileSync(path, content);
    cases.push({ id, result: await observe(() => metrics(path)) });
  }
  cases.push({
    id: "missing",
    result: await observe(() => metrics(path + ".missing")),
  });
  process.stdout.write(JSON.stringify({ cases }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
