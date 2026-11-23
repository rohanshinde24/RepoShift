const { delivery } = require(process.env.OUTPUT + "/src/delivery.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "rounded", "args": [1.1, 2, true, "CAD", 0]}, {"id": "no-rush", "args": [5, 0, false, "USD", 0]}]) {
    cases.push({ id: item.id, result: await observe(() => delivery(...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
