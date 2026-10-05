import os
import uuid
from math import ceil

from .core import ROOT, atomic_json, recipe
from .store import Store
from .workflow import execute


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, ceil(fraction * len(ordered)) - 1)]


def summarize(attempts):
    result = []
    for configuration in sorted({row["configuration"] for row in attempts}):
        rows = [row for row in attempts if row["configuration"] == configuration]
        successes = [row for row in rows if row["success"]]
        eligible = [row for row in rows if row["initialCheckFailed"]]
        result.append(
            {
                "configuration": configuration,
                "attempts": len(rows),
                "distinctTasks": len({row["task"] for row in rows}),
                "successes": len(successes),
                "successRate": len(successes) / len(rows),
                "deliveryRate": sum(row["delivery"] for row in rows) / len(rows),
                "repairEligible": len(eligible),
                "repairRecovered": sum(row["success"] for row in eligible),
                "repairRecovery": (
                    sum(row["success"] for row in eligible) / len(eligible) if eligible else None
                ),
                "latencyMs": {
                    "median": percentile([row["latencyMs"] for row in rows], 0.5),
                    "p95": percentile([row["latencyMs"] for row in rows], 0.95),
                },
                "successfulLatencyMs": {
                    "median": percentile([row["latencyMs"] for row in successes], 0.5),
                    "p95": percentile([row["latencyMs"] for row in successes], 0.95),
                },
                "tokens": sum(row["tokens"] for row in rows),
                "estimatedCostUsd": None,
            }
        )
    return result


def run_benchmark(split: str, provider: str, quick: bool = False):
    if split not in {"development", "held-out"}:
        raise ValueError("Choose development or held-out")
    if provider not in {"reference", "ollama", "azure"}:
        raise ValueError("Unsupported provider")
    if provider == "azure" and (
        os.getenv("REPOSHIFT_ALLOW_PAID") != "1" or not os.getenv("AZURE_OPENAI_API_KEY")
    ):
        raise RuntimeError("Paid model runs are disabled or credentials are missing")
    tasks = [
        name
        for name in ("sdk-options", "fs-promises", "sdk-wrapper", "fs-settings")
        if recipe(name)["split"] == split
    ]
    if quick:
        tasks = tasks[:1]
    store = Store()
    store.init()
    batch = str(uuid.uuid4())
    attempts = []
    for configuration in ["A", "C"] if quick else ["A", "B", "C"]:
        for task in tasks:
            for trial in range(1 if quick else 3):
                submitted = store.submit(
                    {"recipe": task, "provider": provider, "configuration": configuration},
                    f"{batch}:{configuration}:{task}:{trial}",
                )
                claimed = store.claim(f"benchmark-{batch}", submitted["id"])
                if not claimed:
                    raise RuntimeError("Benchmark run already claimed")
                result = execute(store, claimed)
                artifacts = store.artifacts(result["id"])
                events = store.events(result["id"])
                ended = events[-1]["at"] if events else result["created_at"]
                attempts.append(
                    {
                        "runId": str(result["id"]),
                        "task": task,
                        "configuration": configuration,
                        "provider": provider,
                        "success": result["checkpoint"].get("verification", {}).get("passed") is True,
                        "delivery": any(item["name"] == "pull_request" for item in artifacts),
                        "latencyMs": int((ended - result["created_at"]).total_seconds() * 1000),
                        "initialCheckFailed": any(
                            item["name"] in {"build-0", "visible-0"} and item["value"]["code"] != 0
                            for item in artifacts
                        ),
                        "tokens": result["checkpoint"]["tokens"],
                        "estimatedCostUsd": None,
                        "state": result["state"],
                        "error": result["error"],
                    }
                )
                report = {
                    "batch": batch,
                    "split": split,
                    "model": (
                        os.getenv("REPOSHIFT_OLLAMA_MODEL", "qwen2.5:7b")
                        if provider == "ollama"
                        else os.getenv("AZURE_OPENAI_DEPLOYMENT")
                        if provider == "azure"
                        else None
                    ),
                    "kind": (
                        f"single-{split}-task-smoke-not-a-performance-benchmark"
                        if quick
                        else "reference-orchestration-only"
                        if provider == "reference"
                        else "small-model-pilot-not-release-benchmark"
                    ),
                    "attempts": attempts,
                    "summary": summarize(attempts),
                }
                atomic_json(ROOT / "reports/local" / f"python-benchmark-{batch}.json", report)
                print(f"{configuration}/{task}/{trial}: {result['state']}")
    return report
