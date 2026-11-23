"""Create the distinct synthetic v4 migration programs before model evaluation."""

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUITE = ROOT / "benchmarks/v4"


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n")


def dump(path: Path, data: object) -> None:
    write(path, json.dumps(data, indent=2, ensure_ascii=False))


def js(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def sdk_check(task: dict, cases: list[dict]) -> str:
    lines = [
        'const assert = require("node:assert/strict");',
        f'const {{ {task["export"]} }} = require(process.env.OUTPUT + "/src/{task["module"]}.js");',
    ]
    for case in cases:
        call = f"{task['export']}(...{js(case['args'])})"
        if case.get("error"):
            lines.append(f"assert.throws(() => {call}, /invalid quote/);")
        else:
            lines.append(f"assert.deepEqual({call}, {js(case['expected'])});")
    return "\n".join(lines)


def sdk_probe(task: dict) -> str:
    cases = [{"id": case["id"], "args": case["args"]} for case in task["probe"]]
    call = f"{task['export']}(...item.args)"
    return "\n".join(
        [
            f'const {{ {task["export"]} }} = require(process.env.OUTPUT + "/src/{task["module"]}.js");',
            "async function observe(action) {",
            "  try { return { ok: true, value: await action() }; }",
            "  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }",
            "}",
            "(async () => {",
            "  const cases = [];",
            f"  for (const item of {js(cases)}) {{",
            f"    cases.push({{ id: item.id, result: await observe(() => {call}) }});",
            "  }",
            "  process.stdout.write(JSON.stringify({ cases }));",
            "})().catch(error => { console.error(error); process.exitCode = 1; });",
        ]
    )


def sdk_leaf(name: str, parameters: str, amount: str, currency: str, discount: str | None) -> tuple[str, str]:
    args = f"{amount}, {currency}" + (f", {discount}" if discount else "")
    options = f"amount: {amount}, currency: {currency}" + (f", discount: {discount}" if discount else "")
    return (
        'import { quote } from "../lib/sdk-v1";\n'
        f"export function {name}({parameters}): string {{\n  return quote({args});\n}}"
    ), (
        'import { quote } from "../lib/sdk-v2";\n'
        f"export function {name}({parameters}): string {{\n  return quote({{ {options} }});\n}}"
    )


def add_sdk(task: dict) -> None:
    root = SUITE / "tasks" / task["id"]
    for version in ("sdk-v1", "sdk-v2"):
        source = ROOT / "benchmarks/v3/tasks/sdk-invoice-01/base/lib" / f"{version}.ts"
        write(root / "base/lib" / f"{version}.ts", source.read_text())
    for leaf in task["leaves"]:
        base, reference = sdk_leaf(
            leaf["name"], leaf["parameters"], leaf["amount"], leaf["currency"], leaf.get("discount")
        )
        write(root / "base/src" / f"{leaf['name']}.ts", base)
        write(root / "reference/src" / f"{leaf['name']}.ts", reference)
    write(root / "base/src" / f"{task['module']}.ts", task["api"])
    manifest = {
        "id": task["id"],
        "version": 4,
        "family": "sdk-options",
        "archetype": task["module"],
        "split": task["split"],
        "goal": task["goal"],
        "allowedFiles": [f"src/{leaf['name']}.ts" for leaf in task["leaves"]] + [f"src/{task['module']}.ts"],
        "seedFiles": [f"src/{leaf['name']}.ts" for leaf in task["leaves"]],
    }
    dump(root / "manifest.json", manifest)
    write(root / "visible.cjs", sdk_check(task, task["visible"]))
    write(root / "hidden.cjs", sdk_check(task, task["hidden"]))
    write(SUITE / "probes" / f"{task['module']}.cjs", sdk_probe(task))


def fs_check(task: dict, cases: list[dict]) -> str:
    lines = [
        'const assert = require("node:assert/strict");',
        'const fs = require("node:fs");',
        f'const {{ {task["export"]} }} = require(process.env.OUTPUT + "/src/{task["module"]}.js");',
        "(async () => {",
    ]
    for case in cases:
        path = f"/tmp/{task['module']}-{case['id']}.txt"
        if case.get("content") is not None:
            lines.append(f"  fs.writeFileSync({js(path)}, {js(case['content'])});")
        call = f"{task['export']}({js(path)}, ...{js(case.get('args', []))})"
        if case.get("errorCode"):
            lines.append(f"  await assert.rejects({call}, {{ code: {js(case['errorCode'])} }});")
        elif case.get("errorName"):
            lines.append(f"  await assert.rejects({call}, {case['errorName']});")
        else:
            lines.append(f"  assert.deepEqual(await {call}, {js(case['expected'])});")
    lines.append("})().catch(error => { console.error(error); process.exitCode = 1; });")
    return "\n".join(lines)


def fs_probe(task: dict) -> str:
    cases = [
        {"id": case["id"], "content": case.get("content"), "args": case.get("args", [])}
        for case in task["probe"]
    ]
    call = f"{task['export']}(path, ...item.args)"
    return "\n".join(
        [
            'const fs = require("node:fs");',
            f'const {{ {task["export"]} }} = require(process.env.OUTPUT + "/src/{task["module"]}.js");',
            "async function observe(action) {",
            "  try { return { ok: true, value: await action() }; }",
            "  catch (error) { return { ok: false, name: error.name, code: error.code ?? null }; }",
            "}",
            "(async () => {",
            "  const cases = [];",
            f"  for (const item of {js(cases)}) {{",
            f'    const path = "/tmp/{task["module"]}-probe-" + item.id + ".txt";',
            "    if (item.content !== null) fs.writeFileSync(path, item.content);",
            f"    cases.push({{ id: item.id, result: await observe(() => {call}) }});",
            "  }",
            "  process.stdout.write(JSON.stringify({ cases }));",
            "})().catch(error => { console.error(error); process.exitCode = 1; });",
        ]
    )


def add_fs(task: dict) -> None:
    root = SUITE / "tasks" / task["id"]
    base_reader = ROOT / "benchmarks/v3/tasks/fs-metrics-01/base/src/reader.ts"
    reference_reader = ROOT / "benchmarks/v3/tasks/fs-metrics-01/reference/src/reader.ts"
    write(root / "base/src/reader.ts", base_reader.read_text())
    write(root / "reference/src/reader.ts", reference_reader.read_text())
    parameters = "path: string" + (f", {task['parameters']}" if task.get("parameters") else "")
    arguments = "text" + (f", {task['arguments']}" if task.get("arguments") else "")
    callback_arguments = arguments.replace("text", 'text ?? ""', 1)
    promise_arguments = arguments.replace("text", "await readText(path)", 1)
    parser = task["parser"].strip()
    base = (
        'import { readText } from "./reader";\n'
        + parser
        + f"\nexport function {task['export']}({parameters}): Promise<{task['resultType']}> {{\n"
        + "  return new Promise((resolve, reject) => readText(path, (error, text) => {\n"
        + "    if (error) return reject(error);\n"
        + f"    try {{ resolve(parse({callback_arguments})); }} "
        + "catch (cause) { reject(cause); }\n"
        + "  }));\n}"
    )
    reference = (
        'import { readText } from "./reader";\n'
        + parser
        + f"\nexport async function {task['export']}({parameters}): Promise<{task['resultType']}> {{\n"
        + f"  return parse({promise_arguments});\n}}"
    )
    write(root / "base/src" / f"{task['module']}.ts", base)
    write(root / "reference/src" / f"{task['module']}.ts", reference)
    if task.get("support"):
        for name, content in task["support"].items():
            write(root / "base/src" / name, content)
    manifest = {
        "id": task["id"],
        "version": 4,
        "family": "fs-promises",
        "archetype": task["module"],
        "split": task["split"],
        "goal": task["goal"],
        "allowedFiles": ["src/reader.ts", f"src/{task['module']}.ts"]
        + [f"src/{name}" for name in task.get("support", {})],
        "seedFiles": ["src/reader.ts"],
    }
    dump(root / "manifest.json", manifest)
    write(root / "visible.cjs", fs_check(task, task["visible"]))
    write(root / "hidden.cjs", fs_check(task, task["hidden"]))
    write(SUITE / "probes" / f"{task['module']}.cjs", fs_probe(task))


def freeze() -> None:
    probes = SUITE / "probes"
    dump(
        probes / "manifest.json",
        {
            "version": "probe-v4",
            "probes": {
                path.stem: hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(probes.glob("*.cjs"))
            },
        },
    )
    entries = {}
    for task in sorted((SUITE / "tasks").iterdir()):
        manifest = json.loads((task / "manifest.json").read_text())
        entries[manifest["id"]] = {
            "split": manifest["split"],
            "archetype": manifest["archetype"],
            "files": {
                path.relative_to(task).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(task.rglob("*"))
                if path.is_file()
            },
        }
    dump(
        SUITE / "manifest.json",
        {"version": "v4", "status": "frozen-before-model-evaluation", "tasks": entries},
    )


SDK_TASKS = [
    {
        "id": "sdk-bundle-01",
        "module": "bundle",
        "export": "bundle",
        "split": "development",
        "goal": (
            "Migrate item and shipping quotes to sdk-v2 options while preserving "
            "quantity clamps, discounts, and the bundle API."
        ),
        "leaves": [
            {
                "name": "units",
                "parameters": "price: number, quantity: number, currency: string, discount: number",
                "amount": "price * Math.max(quantity, 0)",
                "currency": "currency",
                "discount": "discount",
            },
            {
                "name": "shipping",
                "parameters": "quantity: number, base: number, currency: string",
                "amount": "base + Math.max(quantity - 3, 0) * 2",
                "currency": "currency",
            },
        ],
        "api": """import { units } from "./units";
import { shipping } from "./shipping";
export function bundle(price: number, quantity: number, base: number,
  currency: string, discount: number) {
  return { items: units(price, quantity, currency, discount),
    shipping: shipping(quantity, base, currency) };
}""",
        "visible": [
            {
                "id": "ordinary",
                "args": [10, 2, 3, "USD", 0.1],
                "expected": {"items": "USD:18.00", "shipping": "USD:3.00"},
            }
        ],
        "hidden": [
            {
                "id": "extra",
                "args": [4, 5, 1, "EUR", 0.25],
                "expected": {"items": "EUR:15.00", "shipping": "EUR:5.00"},
            },
            {"id": "invalid", "args": [5, 2, 1, "USD", 1.2], "error": True},
        ],
        "probe": [
            {"id": "zero", "args": [7, 0, 2, "CAD", 0]},
            {"id": "full-discount", "args": [5, 1, 0, "USD", 1]},
            {"id": "invalid-discount", "args": [5, 2, 1, "USD", -0.2]},
        ],
    },
    {
        "id": "sdk-deposit-01",
        "module": "reservation",
        "export": "reservation",
        "split": "development",
        "goal": (
            "Migrate lodging and cleaning deposit quotes to sdk-v2 options while "
            "preserving waiver behavior and the reservation API."
        ),
        "leaves": [
            {
                "name": "lodging",
                "parameters": "nights: number, rate: number, currency: string",
                "amount": "Math.max(nights, 0) * rate * 0.2",
                "currency": "currency",
            },
            {
                "name": "cleaning",
                "parameters": "fee: number, currency: string, waiver: number",
                "amount": "Math.max(fee, 0)",
                "currency": "currency",
                "discount": "waiver",
            },
        ],
        "api": """import { lodging } from "./lodging";
import { cleaning } from "./cleaning";
export function reservation(nights: number, rate: number, fee: number,
  currency: string, waiver: number) {
  return [lodging(nights, rate, currency), cleaning(fee, currency, waiver)];
}""",
        "visible": [
            {"id": "ordinary", "args": [4, 100, 20, "USD", 0], "expected": ["USD:80.00", "USD:20.00"]}
        ],
        "hidden": [
            {"id": "waiver", "args": [2, 80, 10, "CAD", 0.5], "expected": ["CAD:32.00", "CAD:5.00"]},
            {"id": "negative-days", "args": [-2, 80, 0, "EUR", 0], "expected": ["EUR:0.00", "EUR:0.00"]},
        ],
        "probe": [
            {"id": "partial", "args": [3, 120, 12, "GBP", 0.25]},
            {"id": "invalid-waiver", "args": [1, 100, 10, "USD", 1.5]},
        ],
    },
    {
        "id": "sdk-licence-01",
        "module": "licence",
        "export": "licence",
        "split": "held-out",
        "goal": (
            "Migrate seat and support quotes to sdk-v2 options while preserving "
            "seat clamps, discounts, and the licence API."
        ),
        "leaves": [
            {
                "name": "seats",
                "parameters": "count: number, unit: number, currency: string, discount: number",
                "amount": "Math.max(count, 0) * unit",
                "currency": "currency",
                "discount": "discount",
            },
            {
                "name": "support",
                "parameters": "count: number, monthly: number, currency: string",
                "amount": "Math.max(count, 0) * monthly",
                "currency": "currency",
            },
        ],
        "api": """import { seats } from "./seats";
import { support } from "./support";
export function licence(count: number, unit: number, monthly: number,
  currency: string, discount: number) {
  return { seats: seats(count, unit, currency, discount),
    support: support(count, monthly, currency) };
}""",
        "visible": [
            {
                "id": "ordinary",
                "args": [3, 20, 5, "USD", 0.1],
                "expected": {"seats": "USD:54.00", "support": "USD:15.00"},
            }
        ],
        "hidden": [
            {
                "id": "zero",
                "args": [0, 20, 5, "EUR", 0],
                "expected": {"seats": "EUR:0.00", "support": "EUR:0.00"},
            },
            {"id": "invalid", "args": [1, 20, 5, "USD", -0.1], "error": True},
        ],
        "probe": [
            {"id": "half", "args": [2, 9, 3, "CAD", 0.5]},
            {"id": "negative-count", "args": [-1, 20, 5, "USD", 0]},
        ],
    },
    {
        "id": "sdk-delivery-01",
        "module": "delivery",
        "export": "delivery",
        "split": "held-out",
        "goal": (
            "Migrate weight and rush delivery quotes to sdk-v2 options while "
            "preserving rounded weight charges and rush discounts."
        ),
        "leaves": [
            {
                "name": "weight",
                "parameters": "kg: number, rate: number, currency: string",
                "amount": "Math.ceil(Math.max(kg, 0)) * rate",
                "currency": "currency",
            },
            {
                "name": "rush",
                "parameters": "priority: boolean, currency: string, discount: number",
                "amount": "priority ? 12 : 0",
                "currency": "currency",
                "discount": "discount",
            },
        ],
        "api": """import { weight } from "./weight";
import { rush } from "./rush";
export function delivery(kg: number, rate: number, priority: boolean,
  currency: string, discount: number) {
  return [weight(kg, rate, currency), rush(priority, currency, discount)];
}""",
        "visible": [
            {"id": "ordinary", "args": [2.3, 3, True, "USD", 0.25], "expected": ["USD:9.00", "USD:9.00"]}
        ],
        "hidden": [
            {"id": "zero", "args": [0, 5, False, "EUR", 0], "expected": ["EUR:0.00", "EUR:0.00"]},
            {"id": "invalid-rate", "args": [2, -1, False, "USD", 0], "error": True},
        ],
        "probe": [
            {"id": "rounded", "args": [1.1, 2, True, "CAD", 0]},
            {"id": "no-rush", "args": [5, 0, False, "USD", 0]},
        ],
    },
    {
        "id": "sdk-allocation-01",
        "module": "allocation",
        "export": "allocation",
        "split": "held-out",
        "goal": (
            "Migrate allocation share and administration quotes to sdk-v2 options "
            "while preserving ratio validation and the allocation API."
        ),
        "leaves": [
            {
                "name": "share",
                "parameters": "pool: number, ratio: number, currency: string",
                "amount": "pool * ratio",
                "currency": "currency",
            },
            {
                "name": "admin",
                "parameters": "fee: number, currency: string",
                "amount": "fee",
                "currency": "currency",
            },
        ],
        "api": """import { share } from "./share";
import { admin } from "./admin";
export function allocation(pool: number, ratio: number, fee: number,
  currency: string) {
  return { share: share(pool, ratio, currency), admin: admin(fee, currency) };
}""",
        "visible": [
            {
                "id": "ordinary",
                "args": [100, 0.25, 4, "USD"],
                "expected": {"share": "USD:25.00", "admin": "USD:4.00"},
            }
        ],
        "hidden": [
            {"id": "zero", "args": [55, 0, 0, "EUR"], "expected": {"share": "EUR:0.00", "admin": "EUR:0.00"}},
            {"id": "invalid-ratio", "args": [50, -0.1, 1, "USD"], "error": True},
        ],
        "probe": [
            {"id": "half", "args": [90, 0.5, 2, "CAD"]},
            {"id": "invalid-fee", "args": [10, 0.5, -1, "USD"]},
        ],
    },
    {
        "id": "sdk-penalty-01",
        "module": "penalty",
        "export": "penalty",
        "split": "held-out",
        "goal": (
            "Migrate overdue and damage penalty quotes to sdk-v2 options while "
            "preserving day clamps, waivers, and errors."
        ),
        "leaves": [
            {
                "name": "overdue",
                "parameters": "days: number, rate: number, currency: string, waiver: number",
                "amount": "Math.max(days, 0) * rate",
                "currency": "currency",
                "discount": "waiver",
            },
            {
                "name": "damage",
                "parameters": "cost: number, currency: string",
                "amount": "cost",
                "currency": "currency",
            },
        ],
        "api": """import { overdue } from "./overdue";
import { damage } from "./damage";
export function penalty(days: number, rate: number, cost: number,
  currency: string, waiver: number) {
  return [overdue(days, rate, currency, waiver), damage(cost, currency)];
}""",
        "visible": [{"id": "ordinary", "args": [3, 5, 8, "USD", 0.2], "expected": ["USD:12.00", "USD:8.00"]}],
        "hidden": [
            {"id": "zero", "args": [-2, 5, 0, "EUR", 0], "expected": ["EUR:0.00", "EUR:0.00"]},
            {"id": "invalid-waiver", "args": [1, 5, 0, "USD", 1.1], "error": True},
        ],
        "probe": [
            {"id": "half", "args": [2, 7, 3, "CAD", 0.5]},
            {"id": "invalid-damage", "args": [1, 5, -1, "USD", 0]},
        ],
    },
]


FS_TASKS = [
    {
        "id": "fs-kv-01",
        "module": "kv",
        "export": "lookup",
        "split": "development",
        "goal": (
            "Migrate callback text reads to promises while preserving key-value "
            "parsing, duplicate key behavior, errors, and the lookup API."
        ),
        "parameters": "key: string",
        "arguments": "key",
        "resultType": "string | null",
        "parser": r"""
function parse(text: string, key: string): string | null {
  const entries = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cut = line.indexOf("=");
    if (cut < 0) throw new SyntaxError("invalid entry");
    entries.set(line.slice(0, cut).trim(), line.slice(cut + 1).trim());
  }
  return entries.get(key) ?? null;
}""",
        "visible": [{"id": "ordinary", "content": "alpha=1\nbeta=two", "args": ["beta"], "expected": "two"}],
        "hidden": [
            {"id": "embedded-equals", "content": "x=one=two", "args": ["x"], "expected": "one=two"},
            {"id": "invalid", "content": "broken", "args": ["x"], "errorName": "SyntaxError"},
        ],
        "probe": [
            {"id": "duplicate", "content": "x=old\nx=new", "args": ["x"]},
            {"id": "comment", "content": "# note\na=1", "args": ["missing"]},
            {"id": "missing-file", "content": None, "args": ["x"]},
        ],
    },
    {
        "id": "fs-schedule-01",
        "module": "schedule",
        "export": "earliest",
        "split": "development",
        "goal": (
            "Migrate callback text reads to promises while preserving time validation, "
            "empty schedules, missing-file errors, and the earliest API."
        ),
        "resultType": "number | null",
        "parser": r"""
function parse(text: string): number | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const minutes = lines.map(line => {
    const match = /^(\d{2}):(\d{2})$/.exec(line);
    if (!match) throw new SyntaxError("invalid time");
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) throw new SyntaxError("invalid time");
    return hour * 60 + minute;
  });
  return minutes.length ? Math.min(...minutes) : null;
}""",
        "visible": [{"id": "ordinary", "content": "09:30\n08:15", "expected": 495}],
        "hidden": [
            {"id": "midnight", "content": "23:59\n00:00", "expected": 0},
            {"id": "invalid", "content": "25:00", "errorName": "SyntaxError"},
        ],
        "probe": [
            {"id": "empty", "content": ""},
            {"id": "spaced", "content": " 10:05 \n 09:45"},
            {"id": "missing-file", "content": None},
        ],
    },
    {
        "id": "fs-contacts-01",
        "module": "contacts",
        "export": "contacts",
        "split": "held-out",
        "goal": (
            "Migrate callback text reads to promises while preserving tab-separated "
            "contact validation, email normalization, and errors."
        ),
        "resultType": "string[]",
        "parser": r"""
function parse(text: string): string[] {
  const emails = new Set<string>();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const fields = line.split("\t");
    if (fields.length !== 2 || !fields[0]?.trim() || !fields[1]?.includes("@")) {
      throw new SyntaxError("invalid contact");
    }
    emails.add(fields[1].trim().toLowerCase());
  }
  return [...emails].sort();
}""",
        "visible": [
            {
                "id": "ordinary",
                "content": "Ada\tADA@EXAMPLE.COM\nBob\tbob@example.com",
                "expected": ["ada@example.com", "bob@example.com"],
            }
        ],
        "hidden": [
            {
                "id": "duplicate",
                "content": "A\tX@EXAMPLE.COM\nB\tx@example.com",
                "expected": ["x@example.com"],
            },
            {"id": "invalid", "content": "A\tinvalid", "errorName": "SyntaxError"},
        ],
        "probe": [
            {"id": "empty", "content": ""},
            {"id": "one", "content": "Z\tz@EXAMPLE.COM"},
            {"id": "missing-file", "content": None},
        ],
    },
    {
        "id": "fs-stats-01",
        "module": "stats",
        "export": "stats",
        "split": "held-out",
        "goal": (
            "Migrate callback text reads to promises while preserving numeric "
            "summary results, invalid-number errors, and empty input."
        ),
        "resultType": "{ min: number; max: number; mean: number } | null",
        "parser": r"""
function parse(text: string): { min: number; max: number; mean: number } | null {
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const values = words.map(word => {
    const value = Number(word);
    if (!Number.isFinite(value)) throw new SyntaxError("invalid number");
    return value;
  });
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return { min: Math.min(...values), max: Math.max(...values), mean: sum / values.length };
}""",
        "visible": [{"id": "ordinary", "content": "1 3 5", "expected": {"min": 1, "max": 5, "mean": 3}}],
        "hidden": [
            {"id": "negative", "content": "-2 4", "expected": {"min": -2, "max": 4, "mean": 1}},
            {"id": "invalid", "content": "1 bad", "errorName": "SyntaxError"},
        ],
        "probe": [
            {"id": "empty", "content": ""},
            {"id": "fractional", "content": "1.5 2.5"},
            {"id": "missing-file", "content": None},
        ],
    },
    {
        "id": "fs-tags-01",
        "module": "tags",
        "export": "tags",
        "split": "held-out",
        "goal": (
            "Migrate callback text reads to promises while preserving JSON "
            "parsing, normalized unique tags, and error types."
        ),
        "resultType": "string[]",
        "parser": r"""
function parse(text: string): string[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data) || data.some(item => typeof item !== "string")) {
    throw new SyntaxError("invalid tags");
  }
  return [...new Set(data.map((item: string) => item.toLowerCase()))].sort();
}""",
        "visible": [{"id": "ordinary", "content": '["Red","blue","red"]', "expected": ["blue", "red"]}],
        "hidden": [
            {"id": "empty-array", "content": "[]", "expected": []},
            {"id": "malformed", "content": "{", "errorName": "SyntaxError"},
        ],
        "probe": [
            {"id": "unicode", "content": '["Zoë","zoë"]'},
            {"id": "invalid-type", "content": "[1]"},
            {"id": "missing-file", "content": None},
        ],
    },
    {
        "id": "fs-policy-01",
        "module": "policy",
        "export": "decision",
        "split": "held-out",
        "goal": (
            "Migrate callback text reads to promises while preserving policy "
            "overrides, invalid-rule errors, and lookup behavior."
        ),
        "parameters": "key: string",
        "arguments": "key",
        "resultType": "boolean | null",
        "parser": r"""
function parse(text: string, key: string): boolean | null {
  const rules = new Map<string, boolean>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const fields = line.split(":");
    if (fields.length !== 2 || !fields[0]?.trim() || !["allow", "deny"].includes(fields[1])) {
      throw new SyntaxError("invalid rule");
    }
    rules.set(fields[0].trim(), fields[1] === "allow");
  }
  return rules.get(key) ?? null;
}""",
        "visible": [
            {"id": "ordinary", "content": "ship:allow\nrefund:deny", "args": ["refund"], "expected": False}
        ],
        "hidden": [
            {"id": "override", "content": "ship:deny\nship:allow", "args": ["ship"], "expected": True},
            {"id": "invalid", "content": "ship:maybe", "args": ["ship"], "errorName": "SyntaxError"},
        ],
        "probe": [
            {"id": "absent", "content": "ship:allow", "args": ["other"]},
            {"id": "empty", "content": "", "args": ["ship"]},
            {"id": "missing-file", "content": None, "args": ["ship"]},
        ],
    },
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if (SUITE / "manifest.json").exists() and not args.force:
        raise ValueError("v4 is already frozen; pass --force only before model evaluation")
    for task in SDK_TASKS:
        add_sdk(task)
    for task in FS_TASKS:
        add_fs(task)
    freeze()
    print(f"Created and froze {len(SDK_TASKS) + len(FS_TASKS)} v4 tasks")


if __name__ == "__main__":
    main()
