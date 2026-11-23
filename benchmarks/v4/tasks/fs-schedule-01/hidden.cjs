const assert = require("node:assert/strict");
const fs = require("node:fs");
const { earliest } = require(process.env.OUTPUT + "/src/schedule.js");
(async () => {
  fs.writeFileSync("/tmp/schedule-midnight.txt", "23:59\n00:00");
  assert.deepEqual(await earliest("/tmp/schedule-midnight.txt", ...[]), 0);
  fs.writeFileSync("/tmp/schedule-invalid.txt", "25:00");
  await assert.rejects(earliest("/tmp/schedule-invalid.txt", ...[]), SyntaxError);
})().catch(error => { console.error(error); process.exitCode = 1; });
