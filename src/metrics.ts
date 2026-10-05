export interface Attempt {
  runId?: string;
  task: string;
  configuration: string;
  provider: string;
  success: boolean;
  delivery: boolean;
  latencyMs: number;
  initialCheckFailed: boolean;
  tokens: number;
  estimatedCostUsd: number | null;
  state: string;
  error?: string | null;
}
function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}
export function summarize(attempts: Attempt[]) {
  return [...new Set(attempts.map((a) => a.configuration))].map(
    (configuration) => {
      const rows = attempts.filter((a) => a.configuration === configuration),
        successes = rows.filter((a) => a.success),
        repairEligible = rows.filter((a) => a.initialCheckFailed),
        knownCost = rows.every((a) => a.estimatedCostUsd !== null);
      return {
        configuration,
        attempts: rows.length,
        distinctTasks: new Set(rows.map((r) => r.task)).size,
        successes: successes.length,
        successRate: successes.length / rows.length,
        deliveryRate: rows.filter((a) => a.delivery).length / rows.length,
        repairEligible: repairEligible.length,
        repairRecovered: repairEligible.filter((a) => a.success).length,
        repairRecovery: repairEligible.length
          ? repairEligible.filter((a) => a.success).length /
            repairEligible.length
          : null,
        latencyMs: {
          median: percentile(
            rows.map((a) => a.latencyMs),
            0.5,
          ),
          p95: percentile(
            rows.map((a) => a.latencyMs),
            0.95,
          ),
        },
        successfulLatencyMs: {
          median: percentile(
            successes.map((a) => a.latencyMs),
            0.5,
          ),
          p95: percentile(
            successes.map((a) => a.latencyMs),
            0.95,
          ),
        },
        tokens: rows.reduce((n, a) => n + a.tokens, 0),
        estimatedCostUsd: knownCost
          ? rows.reduce((n, a) => n + a.estimatedCostUsd!, 0)
          : null,
      };
    },
  );
}
