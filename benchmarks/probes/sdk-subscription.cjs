const { plan } = require(process.env.OUTPUT + "/src/plan.js");

async function observe(action) {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, name: error.name, code: error.code ?? null };
  }
}

(async () => {
  const cases = [];
  for (const [id, args] of [
    ["discount", [9, 3, 2, "EUR", 0.25]],
    ["zero", [0, 1, 1, "USD", 0]],
    ["full-discount", [4.5, 6, 1, "GBP", 1]],
    ["invalid-discount", [3, 1, 1, "CAD", 1.5]],
  ]) {
    cases.push({ id, result: await observe(() => plan(...args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
