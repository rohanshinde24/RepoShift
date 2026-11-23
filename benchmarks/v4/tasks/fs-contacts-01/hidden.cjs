const assert = require("node:assert/strict");
const fs = require("node:fs");
const { contacts } = require(process.env.OUTPUT + "/src/contacts.js");
(async () => {
  fs.writeFileSync("/tmp/contacts-duplicate.txt", "A\tX@EXAMPLE.COM\nB\tx@example.com");
  assert.deepEqual(await contacts("/tmp/contacts-duplicate.txt", ...[]), ["x@example.com"]);
  fs.writeFileSync("/tmp/contacts-invalid.txt", "A\tinvalid");
  await assert.rejects(contacts("/tmp/contacts-invalid.txt", ...[]), SyntaxError);
})().catch(error => { console.error(error); process.exitCode = 1; });
