const { allocation } = require(process.env.OUTPUT + "/src/allocation.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "half", "args": [90, 0.5, 2, "CAD"]}, {"id": "invalid-fee", "args": [10, 0.5, -1, "USD"]}]) {
    cases.push({ id: item.id, result: await observe(() => allocation(...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
