const assert = require("node:assert/strict");
const fs = require("node:fs");
const { tags } = require(process.env.OUTPUT + "/src/tags.js");
(async () => {
  fs.writeFileSync("/tmp/tags-empty-array.txt", "[]");
  assert.deepEqual(await tags("/tmp/tags-empty-array.txt", ...[]), []);
  fs.writeFileSync("/tmp/tags-malformed.txt", "{");
  await assert.rejects(tags("/tmp/tags-malformed.txt", ...[]), SyntaxError);
})().catch(error => { console.error(error); process.exitCode = 1; });
