const assert = require("node:assert/strict");
const { invoice } = require(process.env.OUTPUT + "/src/invoice.js");
assert.deepEqual(invoice(0, 0, 0, "EUR", 0), {
  charge: "EUR:0.00",
  tax: "EUR:0.00",
});
assert.deepEqual(invoice(20, -30, 0.25, "CAD", 0.5), {
  charge: "CAD:0.00",
  tax: "CAD:5.00",
});
assert.throws(() => invoice(10, 1, -0.1, "USD", 0), /invalid quote/);
assert.throws(() => invoice(10, 1, 0.1, "USD", 1.1), /invalid quote/);
