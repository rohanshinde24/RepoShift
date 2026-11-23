const assert = require("node:assert/strict");
const { route } = require(process.env.OUTPUT + "/src/route.js");
assert.deepEqual(route(10, 2, [3, 5], "USD", 0.25), ["USD:20.00", "USD:6.00"]);
