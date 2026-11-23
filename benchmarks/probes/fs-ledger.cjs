const fs = require("node:fs");
const { ledger } = require(process.env.OUTPUT + "/src/ledger.js");

async function observe(action) {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, name: error.name, code: error.code ?? null };
  }
}

(async () => {
  const amounts = "/tmp/probe-ledger-amounts.txt";
  const currency = "/tmp/probe-ledger-currency.txt";
  const cases = [];
  for (const [id, amountText, currencyText] of [
    ["positive", "4 7", "cad"],
    ["signed", "8 -3 0", " eur "],
    ["empty", "", ""],
    ["fractional", "1.5 2.25", "jpy"],
  ]) {
    fs.writeFileSync(amounts, amountText);
    fs.writeFileSync(currency, currencyText);
    cases.push({ id, result: await observe(() => ledger(amounts, currency)) });
  }
  cases.push({
    id: "missing-amounts",
    result: await observe(() => ledger(amounts + ".missing", currency)),
  });
  process.stdout.write(JSON.stringify({ cases }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
