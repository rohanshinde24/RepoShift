const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
const {loadConfig} = require(process.env.OUTPUT + '/src/config.js');
fs.writeFileSync('/tmp/hidden-config.json', JSON.stringify({name:'different',enabled:false}));
assert.deepEqual(await loadConfig('/tmp/hidden-config.json'), {name:'different',enabled:false});
await assert.rejects(loadConfig('/tmp/does-not-exist'), {code:'ENOENT'});
fs.writeFileSync('/tmp/invalid.json', '{broken');
await assert.rejects(loadConfig('/tmp/invalid.json'), SyntaxError);
fs.writeFileSync('/tmp/config with spaces.json', JSON.stringify({name:'नमस्ते 🌍',enabled:false}));
fs.writeFileSync('/tmp/empty-name.json', JSON.stringify({name:'',enabled:true}));
assert.deepEqual(await Promise.all([
 loadConfig('/tmp/config with spaces.json'), loadConfig('/tmp/empty-name.json')
]), [{name:'नमस्ते 🌍',enabled:false},{name:'',enabled:true}]);
const {readText} = require(process.env.OUTPUT + '/src/reader.js');
assert.equal(await readText('/tmp/invalid.json'), '{broken');

})().catch(error => { console.error(error); process.exitCode = 1; });
