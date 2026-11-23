const assert = require("node:assert/strict");
const { receipt } = require(process.env.OUTPUT + "/src/receipt.js");
assert.deepEqual(receipt(0, "EUR", 0), { refund: "-EUR:0.00", fee: "EUR:0.00" });
assert.deepEqual(receipt(20, "CAD", 0.25), { refund: "-CAD:15.00", fee: "CAD:1.00" });
assert.throws(() => receipt(10, "USD", 1.1), /invalid quote/);
