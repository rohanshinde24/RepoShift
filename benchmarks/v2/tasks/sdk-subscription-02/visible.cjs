const assert = require("node:assert/strict");
const { plan } = require(process.env.OUTPUT + "/src/plan.js");
assert.deepEqual(plan(10, 2, 1, "USD", 0), ["USD:20.00", "USD:122.00"]);
