const assert = require("node:assert/strict");
const fs = require("node:fs");
const { profile } = require(process.env.OUTPUT + "/src/profile.js");
(async () => {
  fs.writeFileSync("/tmp/profile-name-2.txt", "  Béa  ");
  fs.writeFileSync("/tmp/profile-age-2.json", '{"age":0}');
  assert.deepEqual(await profile("/tmp/profile-name-2.txt", "/tmp/profile-age-2.json"), { name: "Béa", age: 0 });
  fs.writeFileSync("/tmp/profile-age-default.json", '{}');
  assert.deepEqual(await profile("/tmp/profile-name-2.txt", "/tmp/profile-age-default.json"), { name: "Béa", age: 3 });
  await assert.rejects(profile("/tmp/profile-missing.txt", "/tmp/profile-age-2.json"), { code: "ENOENT" });
  fs.writeFileSync("/tmp/profile-age-bad.json", "{broken");
  await assert.rejects(profile("/tmp/profile-name-2.txt", "/tmp/profile-age-bad.json"), SyntaxError);
})().catch((error) => { console.error(error); process.exitCode = 1; });
