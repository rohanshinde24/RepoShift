const assert = require("node:assert/strict");
const fs = require("node:fs");
const { ledger } = require(process.env.OUTPUT + "/src/ledger.js");
(async () => {
  fs.writeFileSync("/tmp/ledger-amounts.txt", "2 3");
  fs.writeFileSync("/tmp/ledger-currency.txt", "eur");
  assert.deepEqual(await ledger("/tmp/ledger-amounts.txt", "/tmp/ledger-currency.txt"), { total: 7, currency: "EUR" });
})().catch((error) => { console.error(error); process.exitCode = 1; });
