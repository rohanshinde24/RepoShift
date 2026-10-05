const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
const {cartSummary}=require(process.env.OUTPUT+'/src/summary.js');
for(const [amount,currency,units,discount] of [[8.5,'EUR',3,0.2],[0,'JPY',1,1],[42.2,'INR',4,0]]){assert.equal(cartSummary(amount,currency,units,discount),`${currency}:${(amount*(1-discount)).toFixed(2)}|${currency}:${(amount*units*(1-discount)).toFixed(2)}`);}
assert.throws(()=>cartSummary(3,'USD',-2,0),/invalid/);

})().catch(error=>{console.error(error);process.exitCode=1});
