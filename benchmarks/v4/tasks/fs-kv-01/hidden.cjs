const assert = require("node:assert/strict");
const fs = require("node:fs");
const { lookup } = require(process.env.OUTPUT + "/src/kv.js");
(async () => {
  fs.writeFileSync("/tmp/kv-embedded-equals.txt", "x=one=two");
  assert.deepEqual(await lookup("/tmp/kv-embedded-equals.txt", ...["x"]), "one=two");
  fs.writeFileSync("/tmp/kv-invalid.txt", "broken");
  await assert.rejects(lookup("/tmp/kv-invalid.txt", ...["x"]), SyntaxError);
})().catch(error => { console.error(error); process.exitCode = 1; });
