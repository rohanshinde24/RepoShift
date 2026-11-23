const { reservation } = require(process.env.OUTPUT + "/src/reservation.js");
async function observe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }
}
(async () => {
  const cases = [];
  for (const item of [{"id": "partial", "args": [3, 120, 12, "GBP", 0.25]}, {"id": "invalid-waiver", "args": [1, 100, 10, "USD", 1.5]}]) {
    cases.push({ id: item.id, result: await observe(() => reservation(...item.args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch(error => { console.error(error); process.exitCode = 1; });
