import { analyze } from "./analysis.js";
import { migrationAssertions } from "./verification.js";
import {
  introducedFallbackCatchFiles,
  repairSingleErrorWrapper,
  repairSingleFallbackCatch,
} from "./repair-focus.js";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const result =
  input.action === "analyze"
    ? await analyze(input.root)
    : input.action === "assert"
      ? migrationAssertions(input.files, input.recipe)
      : input.action === "fallback-catches"
        ? introducedFallbackCatchFiles(input.before, input.after, input.allowed)
        : input.action === "repair-fallback-catch"
          ? repairSingleFallbackCatch(input.before, input.after, input.allowed)
          : input.action === "repair-error-wrapper"
            ? repairSingleErrorWrapper(input.before, input.after, input.allowed)
            : (() => {
                throw new Error("Unknown helper action");
              })();
process.stdout.write(JSON.stringify(result));
