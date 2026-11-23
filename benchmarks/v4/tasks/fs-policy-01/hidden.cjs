const assert = require("node:assert/strict");
const fs = require("node:fs");
const { decision } = require(process.env.OUTPUT + "/src/policy.js");
(async () => {
  fs.writeFileSync("/tmp/policy-override.txt", "ship:deny\nship:allow");
  assert.deepEqual(await decision("/tmp/policy-override.txt", ...["ship"]), true);
  fs.writeFileSync("/tmp/policy-invalid.txt", "ship:maybe");
  await assert.rejects(decision("/tmp/policy-invalid.txt", ...["ship"]), SyntaxError);
})().catch(error => { console.error(error); process.exitCode = 1; });
