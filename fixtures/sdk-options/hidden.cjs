const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
const {invoice} = require(process.env.OUTPUT + '/src/service.js');
for (const [amount,currency,discount] of [[7.5,'EUR',0.2],[0,'JPY',1],[199.99,'GBP',0.37]]) {
 assert.deepEqual(invoice(amount,currency,discount), {retail:`${currency}:${amount.toFixed(2)}`,wholesale:`${currency}:${(amount*(1-discount)).toFixed(2)}`});
}
assert.throws(()=>invoice(-1,'USD',0), /invalid/);
assert.throws(()=>invoice(10,'USD',2), /invalid/);
assert.throws(()=>invoice(10,'USD',-0.01), /invalid/);
for (const amount of [0, 0.01, 1.005, 1234.56]) {
 for (const discount of [0, 0.5, 1]) {
  assert.deepEqual(invoice(amount,'INR',discount), {
   retail:`INR:${amount.toFixed(2)}`,
   wholesale:`INR:${(amount*(1-discount)).toFixed(2)}`
  });
 }
}

})().catch(error => { console.error(error); process.exitCode = 1; });
