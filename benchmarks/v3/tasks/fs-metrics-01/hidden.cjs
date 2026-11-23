const assert = require("node:assert/strict");
const fs = require("node:fs");
const { metrics } = require(process.env.OUTPUT + "/src/metrics.js");
(async () => {
  const empty = "/tmp/metrics-empty.txt";
  fs.writeFileSync(empty, "");
  assert.deepEqual(await metrics(empty), { count: 0, sum: 0, average: 0 });
  const signed = "/tmp/metrics-signed.txt";
  fs.writeFileSync(signed, "-2 0 5.5");
  assert.deepEqual(await metrics(signed), { count: 3, sum: 3.5, average: 3.5 / 3 });
  const bad = "/tmp/metrics-bad.txt";
  fs.writeFileSync(bad, "1 nope 3");
  await assert.rejects(metrics(bad), SyntaxError);
  await assert.rejects(metrics("/tmp/metrics-missing.txt"), { code: "ENOENT" });
})().catch((error) => { console.error(error); process.exitCode = 1; });
