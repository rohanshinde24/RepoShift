const assert = require("node:assert/strict");
const fs = require("node:fs");
const { metrics } = require(process.env.OUTPUT + "/src/metrics.js");
(async () => {
  const path = "/tmp/metrics-visible.txt";
  fs.writeFileSync(path, "2 4 6");
  assert.deepEqual(await metrics(path), { count: 3, sum: 12, average: 4 });
})().catch((error) => { console.error(error); process.exitCode = 1; });
