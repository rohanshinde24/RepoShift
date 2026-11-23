const fs = require("node:fs");
const { decision } = require(process.env.OUTPUT + "/src/policy.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "absent", "content": "ship:allow", "args": ["other"]}, {"id": "empty", "content": "", "args": ["ship"]}, {"id": "missing-file", "content": null, "args": ["ship"]}]) {
    const path = "/tmp/policy-probe-" + item.id + ".txt";
    if (item.content !== null) fs.writeFileSync(path, item.content);
    cases.push({ id: item.id, result: await observe(() => decision(path, ...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
