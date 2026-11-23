const assert = require("node:assert/strict");
const { order } = require(process.env.OUTPUT + "/src/order.js");
for (const [unit, quantity, weight, rate, currency] of [
  [2, 3, 4, 5, "EUR"],
  [0, 2, 1, 7, "JPY"],
  [8, 4, 2, 3, "GBP"],
]) {
  assert.deepEqual(order(unit, quantity, weight, rate, currency), {
    line: `${currency}:${(unit * quantity).toFixed(2)}`,
    freight: `${currency}:${(weight * rate + 4).toFixed(2)}`,
  });
}
assert.throws(() => order(-1, 1, 1, 1, "USD"), /invalid/);
