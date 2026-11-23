const assert = require("node:assert/strict");
const fs = require("node:fs");
const { render } = require(process.env.OUTPUT + "/src/render.js");
(async () => {
  const template = "/tmp/template-hidden.txt";
  const data = "/tmp/template-data-hidden.json";
  fs.writeFileSync(template, "{{name}}/{{name}}:{{count}}");
  fs.writeFileSync(data, '{"name":"Zoë","count":0}');
  assert.equal(await render(template, data), "Zoë/Zoë:0");
  fs.writeFileSync(data, "{broken");
  await assert.rejects(render(template, data), SyntaxError);
  await assert.rejects(render("/tmp/template-missing.txt", data), { code: "ENOENT" });
})().catch((error) => { console.error(error); process.exitCode = 1; });
