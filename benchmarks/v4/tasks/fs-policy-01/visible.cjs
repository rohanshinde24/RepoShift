const assert = require("node:assert/strict");
const fs = require("node:fs");
const { decision } = require(process.env.OUTPUT + "/src/policy.js");
(async () => {
  fs.writeFileSync("/tmp/policy-ordinary.txt", "ship:allow\nrefund:deny");
  assert.deepEqual(await decision("/tmp/policy-ordinary.txt", ...["refund"]), false);
})().catch(error => { console.error(error); process.exitCode = 1; });
