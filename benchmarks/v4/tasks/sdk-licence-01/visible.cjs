const assert = require("node:assert/strict");
const { licence } = require(process.env.OUTPUT + "/src/licence.js");
assert.deepEqual(licence(...[3, 20, 5, "USD", 0.1]), {"seats": "USD:54.00", "support": "USD:15.00"});
