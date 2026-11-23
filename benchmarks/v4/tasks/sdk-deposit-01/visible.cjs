const assert = require("node:assert/strict");
const { reservation } = require(process.env.OUTPUT + "/src/reservation.js");
assert.deepEqual(reservation(...[4, 100, 20, "USD", 0]), ["USD:80.00", "USD:20.00"]);
