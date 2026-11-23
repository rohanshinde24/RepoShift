const { penalty } = require(process.env.OUTPUT + "/src/penalty.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "half", "args": [2, 7, 3, "CAD", 0.5]}, {"id": "invalid-damage", "args": [1, 5, -1, "USD", 0]}]) {
    cases.push({ id: item.id, result: await observe(() => penalty(...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
