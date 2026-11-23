const assert = require("node:assert/strict");
const fs = require("node:fs");
const { earliest } = require(process.env.OUTPUT + "/src/schedule.js");
(async () => {
  fs.writeFileSync("/tmp/schedule-ordinary.txt", "09:30\n08:15");
  assert.deepEqual(await earliest("/tmp/schedule-ordinary.txt", ...[]), 495);
})().catch(error => { console.error(error); process.exitCode = 1; });
