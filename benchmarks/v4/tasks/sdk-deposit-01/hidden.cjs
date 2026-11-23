const assert = require("node:assert/strict");
const { reservation } = require(process.env.OUTPUT + "/src/reservation.js");
assert.deepEqual(reservation(...[2, 80, 10, "CAD", 0.5]), ["CAD:32.00", "CAD:5.00"]);
assert.deepEqual(reservation(...[-2, 80, 0, "EUR", 0]), ["EUR:0.00", "EUR:0.00"]);
