const assert = require("node:assert/strict");
const fs = require("node:fs");
const { ledger } = require(process.env.OUTPUT + "/src/ledger.js");
(async () => {
  fs.writeFileSync("/tmp/ledger-amounts-2.txt", "10\n-4\n1");
  fs.writeFileSync("/tmp/ledger-currency-2.txt", "  gbp  ");
  assert.deepEqual(await ledger("/tmp/ledger-amounts-2.txt", "/tmp/ledger-currency-2.txt"), { total: 8, currency: "GBP" });
  fs.writeFileSync("/tmp/ledger-empty-amounts.txt", "");
  fs.writeFileSync("/tmp/ledger-empty-currency.txt", "");
  assert.deepEqual(await ledger("/tmp/ledger-empty-amounts.txt", "/tmp/ledger-empty-currency.txt"), { total: 1, currency: "USD" });
  await assert.rejects(ledger("/tmp/ledger-missing-amounts", "/tmp/ledger-currency-2.txt"), { code: "ENOENT" });
})().catch((error) => { console.error(error); process.exitCode = 1; });
