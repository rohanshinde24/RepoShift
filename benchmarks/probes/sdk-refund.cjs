const { receipt } = require(process.env.OUTPUT + "/src/receipt.js");

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
    ["small", [-8, "EUR", 0]],
    ["capped", [-120, "USD", 0.2]],
    ["positive-input", [10, "CAD", 0.5]],
    ["invalid-discount", [6, "JPY", -0.1]],
  ]) {
    cases.push({ id, result: await observe(() => receipt(...args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
