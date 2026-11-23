const assert = require("node:assert/strict");
const { allocation } = require(process.env.OUTPUT + "/src/allocation.js");
assert.deepEqual(allocation(...[55, 0, 0, "EUR"]), {"share": "EUR:0.00", "admin": "EUR:0.00"});
assert.throws(() => allocation(...[50, -0.1, 1, "USD"]), /invalid quote/);
