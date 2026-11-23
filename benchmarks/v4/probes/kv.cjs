const fs = require("node:fs");
const { lookup } = require(process.env.OUTPUT + "/src/kv.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "duplicate", "content": "x=old\nx=new", "args": ["x"]}, {"id": "comment", "content": "# note\na=1", "args": ["missing"]}, {"id": "missing-file", "content": null, "args": ["x"]}]) {
    const path = "/tmp/kv-probe-" + item.id + ".txt";
    if (item.content !== null) fs.writeFileSync(path, item.content);
    cases.push({ id: item.id, result: await observe(() => lookup(path, ...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
