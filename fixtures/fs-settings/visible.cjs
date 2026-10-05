const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
const {renderDashboard}=require(process.env.OUTPUT+'/src/dashboard.js');
fs.writeFileSync('/tmp/settings.json',JSON.stringify({theme:'dark'}));
assert.equal(await renderDashboard('/tmp/settings.json'),'dark:on');

})().catch(error=>{console.error(error);process.exitCode=1});
