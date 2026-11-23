const assert = require("node:assert/strict");
const fs = require("node:fs");
const { stats } = require(process.env.OUTPUT + "/src/stats.js");
(async () => {
  fs.writeFileSync("/tmp/stats-negative.txt", "-2 4");
  assert.deepEqual(await stats("/tmp/stats-negative.txt", ...[]), {"min": -2, "max": 4, "mean": 1});
  fs.writeFileSync("/tmp/stats-invalid.txt", "1 bad");
  await assert.rejects(stats("/tmp/stats-invalid.txt", ...[]), SyntaxError);
})().catch(error => { console.error(error); process.exitCode = 1; });
