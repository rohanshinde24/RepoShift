const assert = require("node:assert/strict");
const { allocation } = require(process.env.OUTPUT + "/src/allocation.js");
assert.deepEqual(allocation(...[100, 0.25, 4, "USD"]), {"share": "USD:25.00", "admin": "USD:4.00"});
