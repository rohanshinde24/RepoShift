const assert = require("node:assert/strict");
const { delivery } = require(process.env.OUTPUT + "/src/delivery.js");
assert.deepEqual(delivery(...[2.3, 3, true, "USD", 0.25]), ["USD:9.00", "USD:9.00"]);
