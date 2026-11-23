const assert = require("node:assert/strict");
const { order } = require(process.env.OUTPUT + "/src/order.js");
assert.deepEqual(order(10, 2, 3, 4, "USD"), { line: "USD:20.00", freight: "USD:16.00" });
