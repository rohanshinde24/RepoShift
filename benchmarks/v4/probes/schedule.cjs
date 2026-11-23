const fs = require("node:fs");
const { earliest } = require(process.env.OUTPUT + "/src/schedule.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "empty", "content": "", "args": []}, {"id": "spaced", "content": " 10:05 \n 09:45", "args": []}, {"id": "missing-file", "content": null, "args": []}]) {
    const path = "/tmp/schedule-probe-" + item.id + ".txt";
    if (item.content !== null) fs.writeFileSync(path, item.content);
    cases.push({ id: item.id, result: await observe(() => earliest(path, ...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
