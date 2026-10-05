import { analyze } from "./analysis.js";
import { migrationAssertions } from "./verification.js";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const result =
  input.action === "analyze"
    ? await analyze(input.root)
    : input.action === "assert"
      ? migrationAssertions(input.files, input.recipe)
      : (() => {
          throw new Error("Unknown helper action");
        })();
process.stdout.write(JSON.stringify(result));
