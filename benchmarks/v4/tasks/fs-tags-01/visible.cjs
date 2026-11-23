const assert = require("node:assert/strict");
const fs = require("node:fs");
const { tags } = require(process.env.OUTPUT + "/src/tags.js");
(async () => {
  fs.writeFileSync("/tmp/tags-ordinary.txt", "[\"Red\",\"blue\",\"red\"]");
  assert.deepEqual(await tags("/tmp/tags-ordinary.txt", ...[]), ["blue", "red"]);
})().catch(error => { console.error(error); process.exitCode = 1; });
