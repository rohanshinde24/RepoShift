const assert = require("node:assert/strict");
const fs = require("node:fs");
const { report } = require(process.env.OUTPUT + "/src/report.js");
(async () => {
  const path = "/tmp/report-visible.csv";
  fs.writeFileSync(path, "ana,4\nben,6");
  assert.deepEqual(await report(path), { count: 2, total: 10, top: "ben" });
})().catch((error) => { console.error(error); process.exitCode = 1; });
