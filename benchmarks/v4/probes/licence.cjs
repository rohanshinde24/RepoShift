const { licence } = require(process.env.OUTPUT + "/src/licence.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "half", "args": [2, 9, 3, "CAD", 0.5]}, {"id": "negative-count", "args": [-1, 20, 5, "USD", 0]}]) {
    cases.push({ id: item.id, result: await observe(() => licence(...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
