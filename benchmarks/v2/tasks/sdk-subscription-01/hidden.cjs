const assert = require("node:assert/strict");
const { plan } = require(process.env.OUTPUT + "/src/plan.js");
for (const [price, months, years, currency, discount] of [
  [5, 3, 2, "EUR", 0.2],
  [0, 1, 1, "JPY", 0],
  [20, 4, 3, "GBP", 0.5],
]) {
  assert.deepEqual(plan(price, months, years, currency, discount), [
    `${currency}:${(price * months * (1 - discount)).toFixed(2)}`,
    `${currency}:${((price * 12 * years + 1) * (1 - discount)).toFixed(2)}`,
  ]);
}
assert.throws(() => plan(10, 1, 1, "USD", 2), /invalid/);
