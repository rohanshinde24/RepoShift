const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
const {invoice} = require(process.env.OUTPUT + '/src/service.js');
assert.deepEqual(invoice(100, 'USD', 0.1), {retail:'USD:100.00', wholesale:'USD:90.00'});

})().catch(error => { console.error(error); process.exitCode = 1; });
