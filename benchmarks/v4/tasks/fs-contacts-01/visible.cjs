const assert = require("node:assert/strict");
const fs = require("node:fs");
const { contacts } = require(process.env.OUTPUT + "/src/contacts.js");
(async () => {
  fs.writeFileSync("/tmp/contacts-ordinary.txt", "Ada\tADA@EXAMPLE.COM\nBob\tbob@example.com");
  assert.deepEqual(await contacts("/tmp/contacts-ordinary.txt", ...[]), ["ada@example.com", "bob@example.com"]);
})().catch(error => { console.error(error); process.exitCode = 1; });
