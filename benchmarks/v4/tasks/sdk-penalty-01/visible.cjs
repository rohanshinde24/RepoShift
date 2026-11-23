const assert = require("node:assert/strict");
const { penalty } = require(process.env.OUTPUT + "/src/penalty.js");
assert.deepEqual(penalty(...[3, 5, 8, "USD", 0.2]), ["USD:12.00", "USD:8.00"]);
