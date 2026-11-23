const { route } = require(process.env.OUTPUT + "/src/route.js");

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
    ["ordinary", [3.2, 4, [2, 1.5], "EUR", 0.1]],
    ["negative-distance", [-5, 2, [], "USD", 0]],
    ["full-toll-discount", [5, 1.5, [4], "CAD", 1]],
    ["invalid-rate", [2, -2, [], "USD", 0]],
  ]) {
    cases.push({ id, result: await observe(() => route(...args)) });
  }
  process.stdout.write(JSON.stringify({ cases }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
