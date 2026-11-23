const fs = require("node:fs");
const { profile } = require(process.env.OUTPUT + "/src/profile.js");

async function observe(action) {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, name: error.name, code: error.code ?? null };
  }
}

(async () => {
  const name = "/tmp/probe-profile-name.txt";
  const age = "/tmp/probe-profile-age.json";
  fs.writeFileSync(name, "  Zoë  ");
  const cases = [];
  for (const [id, content] of [
    ["age-zero", '{"age":0}'],
    ["age-default", "{}"],
    ["age-fractional", '{"age":2.5}'],
    ["bad-json", "{invalid"],
  ]) {
    fs.writeFileSync(age, content);
    cases.push({ id, result: await observe(() => profile(name, age)) });
  }
  cases.push({
    id: "missing-name",
    result: await observe(() => profile(name + ".missing", age)),
  });
  process.stdout.write(JSON.stringify({ cases }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
