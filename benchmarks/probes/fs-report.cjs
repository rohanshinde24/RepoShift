const fs = require("node:fs");
const { report } = require(process.env.OUTPUT + "/src/report.js");

async function observe(action) {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, name: error.name, code: error.code ?? null };
  }
}

(async () => {
  const path = "/tmp/probe-report.csv";
  const cases = [];
  for (const [id, content] of [
    ["positive", "mae,2\nori,9\nlee,4"],
    ["empty", ""],
    ["tie", "first,5\nsecond,5"],
    ["bad-number", "bad,NaN"],
  ]) {
    fs.writeFileSync(path, content);
    cases.push({ id, result: await observe(() => report(path)) });
  }
  cases.push({
    id: "missing",
    result: await observe(() => report(path + ".missing")),
  });
  process.stdout.write(JSON.stringify({ cases }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
