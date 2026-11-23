const { invoice } = require(process.env.OUTPUT + "/src/invoice.js");

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
    ["discount", [80, 12, 0.06, "EUR", 0.2]],
    ["clamp", [5, -9, 0.1, "USD", 0]],
    ["full-discount", [30, 4, 0, "CAD", 1]],
    ["invalid-tax", [5, 2, -1, "USD", 0]],
  ]) {
    cases.push({ id, result: await observe(() => invoice(...args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
