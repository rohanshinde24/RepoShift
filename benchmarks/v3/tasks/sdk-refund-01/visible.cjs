const assert = require("node:assert/strict");
const { receipt } = require(process.env.OUTPUT + "/src/receipt.js");
assert.deepEqual(receipt(-100, "USD", 0.1), { refund: "-USD:90.00", fee: "USD:5.00" });
