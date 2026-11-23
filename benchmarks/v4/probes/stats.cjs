const fs = require("node:fs");
const { stats } = require(process.env.OUTPUT + "/src/stats.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "empty", "content": "", "args": []}, {"id": "fractional", "content": "1.5 2.5", "args": []}, {"id": "missing-file", "content": null, "args": []}]) {
    const path = "/tmp/stats-probe-" + item.id + ".txt";
    if (item.content !== null) fs.writeFileSync(path, item.content);
    cases.push({ id: item.id, result: await observe(() => stats(path, ...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
