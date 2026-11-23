const fs = require("node:fs");
const { render } = require(process.env.OUTPUT + "/src/render.js");

async function observe(action) {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, name: error.name, code: error.code ?? null };
  }
}

(async () => {
  const template = "/tmp/probe-template.txt";
  const data = "/tmp/probe-template-data.json";
  const cases = [];
  for (const [id, source, values] of [
    ["ordinary", "Hi {{name}}, {{count}} items", '{"name":"Ada","count":3}'],
    ["repeated", "{{name}}/{{name}}/{{count}}", '{"name":"Lee","count":0}'],
    ["invalid-json", "{{name}}", "{bad"],
  ]) {
    fs.writeFileSync(template, source);
    fs.writeFileSync(data, values);
    cases.push({ id, result: await observe(() => render(template, data)) });
  }
  cases.push({
    id: "missing-template",
    result: await observe(() => render(template + ".missing", data)),
  });
  process.stdout.write(JSON.stringify({ cases }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
