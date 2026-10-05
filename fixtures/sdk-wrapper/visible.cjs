const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
const {cartSummary}=require(process.env.OUTPUT+'/src/summary.js');
assert.equal(cartSummary(10,'USD',2,0.1),'USD:9.00|USD:18.00');

})().catch(error=>{console.error(error);process.exitCode=1});
