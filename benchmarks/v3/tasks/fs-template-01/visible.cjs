const assert = require("node:assert/strict");
const fs = require("node:fs");
const { render } = require(process.env.OUTPUT + "/src/render.js");
(async () => {
  const template = "/tmp/template-visible.txt";
  const data = "/tmp/template-data-visible.json";
  fs.writeFileSync(template, "Hello {{name}} x{{count}}");
  fs.writeFileSync(data, '{"name":"Maya","count":3}');
  assert.equal(await render(template, data), "Hello Maya x3");
})().catch((error) => { console.error(error); process.exitCode = 1; });
