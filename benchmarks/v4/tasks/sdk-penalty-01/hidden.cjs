const assert = require("node:assert/strict");
const { penalty } = require(process.env.OUTPUT + "/src/penalty.js");
assert.deepEqual(penalty(...[-2, 5, 0, "EUR", 0]), ["EUR:0.00", "EUR:0.00"]);
assert.throws(() => penalty(...[1, 5, 0, "USD", 1.1]), /invalid quote/);
