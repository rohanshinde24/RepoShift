const assert = require("node:assert/strict");
const fs = require("node:fs");
const { lookup } = require(process.env.OUTPUT + "/src/kv.js");
(async () => {
  fs.writeFileSync("/tmp/kv-ordinary.txt", "alpha=1\nbeta=two");
  assert.deepEqual(await lookup("/tmp/kv-ordinary.txt", ...["beta"]), "two");
})().catch(error => { console.error(error); process.exitCode = 1; });
