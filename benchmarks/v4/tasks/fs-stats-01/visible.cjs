const assert = require("node:assert/strict");
const fs = require("node:fs");
const { stats } = require(process.env.OUTPUT + "/src/stats.js");
(async () => {
  fs.writeFileSync("/tmp/stats-ordinary.txt", "1 3 5");
  assert.deepEqual(await stats("/tmp/stats-ordinary.txt", ...[]), {"min": 1, "max": 5, "mean": 3});
})().catch(error => { console.error(error); process.exitCode = 1; });
