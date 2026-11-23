const fs = require("node:fs");
const { tags } = require(process.env.OUTPUT + "/src/tags.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "unicode", "content": "[\"Zoë\",\"zoë\"]", "args": []}, {"id": "invalid-type", "content": "[1]", "args": []}, {"id": "missing-file", "content": null, "args": []}]) {
    const path = "/tmp/tags-probe-" + item.id + ".txt";
    if (item.content !== null) fs.writeFileSync(path, item.content);
    cases.push({ id: item.id, result: await observe(() => tags(path, ...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
