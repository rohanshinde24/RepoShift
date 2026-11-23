const fs = require("node:fs");
const { contacts } = require(process.env.OUTPUT + "/src/contacts.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "empty", "content": "", "args": []}, {"id": "one", "content": "Z\tz@EXAMPLE.COM", "args": []}, {"id": "missing-file", "content": null, "args": []}]) {
    const path = "/tmp/contacts-probe-" + item.id + ".txt";
    if (item.content !== null) fs.writeFileSync(path, item.content);
    cases.push({ id: item.id, result: await observe(() => contacts(path, ...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
