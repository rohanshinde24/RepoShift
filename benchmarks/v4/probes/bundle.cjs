const { bundle } = require(process.env.OUTPUT + "/src/bundle.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "zero", "args": [7, 0, 2, "CAD", 0]}, {"id": "full-discount", "args": [5, 1, 0, "USD", 1]}, {"id": "invalid-discount", "args": [5, 2, 1, "USD", -0.2]}]) {
    cases.push({ id: item.id, result: await observe(() => bundle(...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
