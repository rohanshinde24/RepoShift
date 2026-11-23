const assert = require("node:assert/strict");
const { invoice } = require(process.env.OUTPUT + "/src/invoice.js");
assert.deepEqual(invoice(100, 10, 0.08, "USD", 0.1), {
  charge: "USD:99.00",
  tax: "USD:8.00",
});
