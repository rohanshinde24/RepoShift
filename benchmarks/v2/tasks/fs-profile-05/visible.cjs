const assert = require("node:assert/strict");
const fs = require("node:fs");
const { profile } = require(process.env.OUTPUT + "/src/profile.js");
(async () => {
  fs.writeFileSync("/tmp/profile-name.txt", " Alice ");
  fs.writeFileSync("/tmp/profile-age.json", '{"age":21}');
  assert.deepEqual(await profile("/tmp/profile-name.txt", "/tmp/profile-age.json"), { name: "Alice", age: 21 });
})().catch((error) => { console.error(error); process.exitCode = 1; });
