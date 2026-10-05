const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
const {renderDashboard}=require(process.env.OUTPUT+'/src/dashboard.js');
fs.writeFileSync('/tmp/settings-off.json',JSON.stringify({theme:'नमस्ते',enabled:false}));
fs.writeFileSync('/tmp/settings-blue.json',JSON.stringify({theme:'blue',enabled:true}));
assert.deepEqual(await Promise.all([renderDashboard('/tmp/settings-off.json'),renderDashboard('/tmp/settings-blue.json')]),['नमस्ते:off','blue:on']);
await assert.rejects(renderDashboard('/tmp/missing-settings'),{code:'ENOENT'});
fs.writeFileSync('/tmp/bad-settings','{oops');await assert.rejects(renderDashboard('/tmp/bad-settings'),SyntaxError);

})().catch(error=>{console.error(error);process.exitCode=1});
