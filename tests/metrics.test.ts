import test from "node:test";
import assert from "node:assert/strict";
import { summarize, type Attempt } from "../src/metrics.js";
test("metrics retain failed attempts and distinguish repair and delivery", () => {
  const common = {
    task: "one",
    configuration: "C",
    provider: "azure",
    delivery: false,
    tokens: 100,
    estimatedCostUsd: null,
    state: "FAILED",
  };
  const rows: Attempt[] = [
    {
      ...common,
      success: true,
      latencyMs: 100,
      initialCheckFailed: true,
      state: "COMPLETE",
    },
    { ...common, success: false, latencyMs: 900000, initialCheckFailed: true },
  ];
  const result = summarize(rows)[0]!;
  assert.equal(result.successRate, 0.5);
  assert.equal(result.distinctTasks, 1);
  assert.equal(result.repairRecovery, 0.5);
  assert.equal(result.deliveryRate, 0);
  assert.equal(result.latencyMs.p95, 900000);
  assert.equal(result.estimatedCostUsd, null);
});
