const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
const {loadConfig} = require(process.env.OUTPUT + '/src/config.js');
fs.writeFileSync('/tmp/config.json', JSON.stringify({name:'demo'}));
assert.deepEqual(await loadConfig('/tmp/config.json'), {name:'demo',enabled:true});

})().catch(error => { console.error(error); process.exitCode = 1; });
