const assert = require("node:assert/strict");
const { bundle } = require(process.env.OUTPUT + "/src/bundle.js");
assert.deepEqual(bundle(...[4, 5, 1, "EUR", 0.25]), {"items": "EUR:15.00", "shipping": "EUR:5.00"});
assert.throws(() => bundle(...[5, 2, 1, "USD", 1.2]), /invalid quote/);
