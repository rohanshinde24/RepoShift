const assert = require("node:assert/strict");
const fs = require("node:fs");
const { report } = require(process.env.OUTPUT + "/src/report.js");
(async () => {
  const empty = "/tmp/report-empty.csv";
  fs.writeFileSync(empty, "");
  assert.deepEqual(await report(empty), { count: 0, total: 0, top: null });
  const signed = "/tmp/report-signed.csv";
  fs.writeFileSync(signed, "a,-2\nb,0\nc,3");
  assert.deepEqual(await report(signed), { count: 3, total: 1, top: "c" });
  const bad = "/tmp/report-bad.csv";
  fs.writeFileSync(bad, "broken,row");
  await assert.rejects(report(bad), SyntaxError);
  await assert.rejects(report("/tmp/report-missing.csv"), { code: "ENOENT" });
})().catch((error) => { console.error(error); process.exitCode = 1; });
