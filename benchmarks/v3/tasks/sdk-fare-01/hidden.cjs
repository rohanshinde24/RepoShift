const assert = require("node:assert/strict");
const { route } = require(process.env.OUTPUT + "/src/route.js");
assert.deepEqual(route(-4, 2, [], "EUR", 0), ["EUR:0.00", "EUR:0.00"]);
assert.deepEqual(route(1.5, 4, [2.5], "CAD", 0.2), ["CAD:6.00", "CAD:2.00"]);
assert.throws(() => route(2, 1, [1], "USD", 1.1), /invalid quote/);
assert.throws(() => route(2, -1, [], "USD", 0), /invalid quote/);
