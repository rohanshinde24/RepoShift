const { order } = require(process.env.OUTPUT + "/src/order.js");

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
    ["standard", [7, 3, 2, 5, "USD"]],
    ["zero", [0, 4, 0, 8, "JPY"]],
    ["fractional", [1.25, 2, 3.5, 0.5, "EUR"]],
    ["negative", [-2, 1, 1, 1, "CAD"]],
  ]) {
    cases.push({ id, result: await observe(() => order(...args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
