const assert = require("node:assert/strict");
const { delivery } = require(process.env.OUTPUT + "/src/delivery.js");
assert.deepEqual(delivery(...[0, 5, false, "EUR", 0]), ["EUR:0.00", "EUR:0.00"]);
assert.throws(() => delivery(...[2, -1, false, "USD", 0]), /invalid quote/);
