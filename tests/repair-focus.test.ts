import assert from "node:assert/strict";
import { test } from "node:test";
import {
  introducedFallbackCatchFiles,
  repairSingleErrorWrapper,
  repairSingleFallbackCatch,
} from "../src/repair-focus.js";

test("focuses a newly introduced catch fallback", () => {
  const before = {
    "src/reader.ts":
      'export const readText = (path: string) => readFile(path, "utf8");',
    "src/caller.ts": "export const load = () => Promise.resolve(1);",
  };
  const after = {
    ...before,
    "src/reader.ts":
      'export const readText = (path: string) => readFile(path, "utf8").catch(error => null);',
    "src/caller.ts": "export const load = () => Promise.resolve(2);",
  };
  assert.deepEqual(
    introducedFallbackCatchFiles(before, after, Object.keys(before)),
    ["src/reader.ts"],
  );
});

test("does not focus a preexisting fallback or a catch that throws", () => {
  const before = {
    "src/old.ts":
      "export function old() { try { return 1; } catch { return null; } }",
    "src/new.ts": "export function next() { return 1; }",
  };
  const after = {
    "src/old.ts": before["src/old.ts"],
    "src/new.ts":
      "export function next() { try { return 2; } catch (error) { throw error; } }",
  };
  assert.deepEqual(
    introducedFallbackCatchFiles(before, after, Object.keys(before)),
    [],
  );
});

test("rethrows one newly introduced fallback catch", () => {
  const before = {
    "src/reader.ts": "export function read() { return load(); }",
  };
  const after = {
    "src/reader.ts":
      "export function read() { try { return load(); } catch (error) { return null; } }",
  };
  assert.deepEqual(
    repairSingleFallbackCatch(before, after, ["src/reader.ts"]),
    {
      path: "src/reader.ts",
      content:
        "export function read() { try { return load(); } catch (error) { throw error; } }",
    },
  );
});

test("rethrows one newly introduced arrow catch fallback", () => {
  const before = { "src/reader.ts": "export const read = () => load();" };
  const after = {
    "src/reader.ts": "export const read = () => load().catch(error => null);",
  };
  assert.deepEqual(
    repairSingleFallbackCatch(before, after, ["src/reader.ts"]),
    {
      path: "src/reader.ts",
      content:
        "export const read = () => load().catch(error => { throw error; });",
    },
  );
});

test("removes a new catch fallback with logging of the caught error", () => {
  const before = { "src/reader.ts": "export const read = () => load();" };
  const after = {
    "src/reader.ts":
      "export const read = () => load().catch(error => { console.error(error); return null; });",
  };
  assert.deepEqual(
    repairSingleFallbackCatch(before, after, ["src/reader.ts"]),
    {
      path: "src/reader.ts",
      content:
        "export const read = () => load().catch(error => { throw error; });",
    },
  );
});

test("does not rewrite ambiguous or unbound catches", () => {
  const before = {
    "src/reader.ts": "export function read() { return load(); }",
  };
  const ambiguous = {
    "src/reader.ts":
      "export function read() { try { return load(); } catch (error) { if (error) return null; return 0; } }",
  };
  const unbound = {
    "src/reader.ts":
      "export function read() { try { return load(); } catch { return null; } }",
  };
  assert.equal(
    repairSingleFallbackCatch(before, ambiguous, ["src/reader.ts"]),
    null,
  );
  assert.equal(
    repairSingleFallbackCatch(before, unbound, ["src/reader.ts"]),
    null,
  );
});

test("does not rewrite an old fallback when a new complex fallback appears", () => {
  const old =
    "function old() { try { return load(); } catch (error) { return null; } }";
  const before = { "src/reader.ts": old };
  const after = {
    "src/reader.ts":
      old +
      "\nfunction next() { try { return load(); } catch (error) { if (error) { console.error(error); return null; } throw error; } }",
  };
  assert.equal(
    repairSingleFallbackCatch(before, after, ["src/reader.ts"]),
    null,
  );
});

test("rethrows a newly introduced generic error wrapper", () => {
  const before = {
    "src/values.ts": "export const load = (path: string) => readText(path);",
  };
  const after = {
    "src/values.ts":
      "export const load = (path: string) => readText(path).catch(error => { if (error instanceof SyntaxError) throw error; throw new Error(error.message); });",
  };
  assert.deepEqual(repairSingleErrorWrapper(before, after, ["src/values.ts"]), {
    path: "src/values.ts",
    content:
      "export const load = (path: string) => readText(path).catch(error => { throw error; });",
  });
});

test("does not rewrite a preexisting or conditional error wrapper", () => {
  const before = {
    "src/values.ts":
      "export const load = () => readText().catch(error => { throw new Error(error.message); });",
  };
  assert.equal(
    repairSingleErrorWrapper(before, before, ["src/values.ts"]),
    null,
  );
  const after = {
    "src/values.ts":
      "export const load = () => readText().catch(error => { if (error) return null; throw new Error(error.message); });",
  };
  assert.equal(
    repairSingleErrorWrapper(before, after, ["src/values.ts"]),
    null,
  );
});
