const assert = require("node:assert/strict");
const { licence } = require(process.env.OUTPUT + "/src/licence.js");
assert.deepEqual(licence(...[0, 20, 5, "EUR", 0]), {"seats": "EUR:0.00", "support": "EUR:0.00"});
assert.throws(() => licence(...[1, 20, 5, "USD", -0.1]), /invalid quote/);
