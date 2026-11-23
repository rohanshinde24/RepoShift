const assert = require("node:assert/strict");
const { bundle } = require(process.env.OUTPUT + "/src/bundle.js");
assert.deepEqual(bundle(...[10, 2, 3, "USD", 0.1]), {"items": "USD:18.00", "shipping": "USD:3.00"});
