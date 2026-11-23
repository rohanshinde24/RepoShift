import json
import os
import re
import uuid
from math import ceil
from statistics import median

from .core import PROBE_ROOT, ROOT, V2_ROOT, V3_ROOT, V4_ROOT, atomic_json, digest, recipe, snapshot, tree
from .store import Store
from .workflow import execute

WORKFLOW_STATES = {
    "ANALYZE",
    "PLAN",
    "EXECUTE",
    "BUILD",
    "TEST",
    "REPAIR",
    "VERIFY",
    "PUBLISH",
    "COMPLETE",
    "FAILED",
    "CANCELLED",
}
CHECK_ARTIFACT = re.compile(
    r"(?:baseline-(?:build|visible)|(?:build|visible|probe)-\d+|probe-baseline|hidden)"
)


def stage_timings(events, created_at):
    durations = {}
    previous_state = "SETUP"
    previous_at = created_at
    for event in events:
        if event["state"] not in WORKFLOW_STATES:
            continue
        elapsed = max(0, int((event["at"] - previous_at).total_seconds() * 1000))
        durations[previous_state] = durations.get(previous_state, 0) + elapsed
        previous_state = event["state"]
        previous_at = event["at"]
    return durations


def check_timings(artifacts):
    return {
        item["name"]: item["value"]["durationMs"]
        for item in artifacts
        if CHECK_ARTIFACT.fullmatch(item["name"])
        and isinstance(item["value"], dict)
        and isinstance(item["value"].get("durationMs"), int)
    }


def attempt_succeeded(run):
    return run["state"] == "COMPLETE" and run["checkpoint"].get("verification", {}).get("passed") is True


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    if fraction == 0.5:
        return median(ordered)
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
                "deliveryRate": (
                    sum(row["delivery"] for row in rows) / len(rows)
                    if all(row["delivery"] is not None for row in rows)
                    else None
                ),
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


def paired_summary(attempts):
    grouped = {}
    for row in attempts:
        if row["configuration"] not in {"A", "C"}:
            continue
        key = (row["task"], row["trial"])
        pair = grouped.setdefault(key, {})
        if row["configuration"] in pair:
            raise ValueError(f"Duplicate benchmark attempt: {key} {row['configuration']}")
        pair[row["configuration"]] = row
    if not grouped or any(set(pair) != {"A", "C"} for pair in grouped.values()):
        raise ValueError("Benchmark requires one A and one C attempt per task and trial")
    pairs = list(grouped.values())
    by_archetype = {}
    for (task, _), pair in grouped.items():
        baseline_archetype = pair["A"].get("archetype", task)
        candidate_archetype = pair["C"].get("archetype", task)
        if baseline_archetype != candidate_archetype:
            raise ValueError(f"Mismatched benchmark archetype: {task}")
        by_archetype.setdefault(baseline_archetype, []).append(pair)
    baseline = [pair["A"] for pair in pairs]
    candidate = [pair["C"] for pair in pairs]
    baseline_median = median(row["latencyMs"] for row in baseline)
    candidate_median = median(row["latencyMs"] for row in candidate)
    return {
        "pairedAttempts": len(pairs),
        "distinctTasks": len({task for task, _ in grouped}),
        "distinctArchetypes": len(by_archetype),
        "byArchetype": [
            {
                "archetype": archetype,
                "pairedAttempts": len(group),
                "baselineSuccesses": sum(pair["A"]["success"] for pair in group),
                "candidateSuccesses": sum(pair["C"]["success"] for pair in group),
            }
            for archetype, group in sorted(by_archetype.items())
        ],
        "baselineSuccesses": sum(row["success"] for row in baseline),
        "candidateSuccesses": sum(row["success"] for row in candidate),
        "successDeltaPercentagePoints": 100
        * (sum(row["success"] for row in candidate) - sum(row["success"] for row in baseline))
        / len(pairs),
        "candidateOnlySuccesses": sum(pair["C"]["success"] and not pair["A"]["success"] for pair in pairs),
        "baselineOnlySuccesses": sum(pair["A"]["success"] and not pair["C"]["success"] for pair in pairs),
        "allAttemptMedianLatencyMs": {"A": baseline_median, "C": candidate_median},
        "allAttemptMedianReduction": 1 - candidate_median / baseline_median if baseline_median else None,
    }


def scheduled_attempts(configurations, tasks, trials):
    for task_index, task in enumerate(tasks):
        for trial in range(trials):
            offset = (task_index + trial) % len(configurations)
            order = configurations[offset:] + configurations[:offset]
            for configuration in order:
                yield configuration, task, trial


def run_benchmark(
    split: str,
    provider: str,
    quick: bool = False,
    suite: str = "v1",
    selected_tasks: list[str] | None = None,
    trials: int = 3,
    compare_only: bool = False,
):
    if split not in {"development", "held-out"}:
        raise ValueError("Choose development or held-out")
    if provider not in {"reference", "ollama", "azure"}:
        raise ValueError("Unsupported provider")
    if suite not in {"v1", "v2", "v3", "v4"} or not 1 <= trials <= 10:
        raise ValueError("Choose v1, v2, v3, or v4 and between one and ten trials")
    if provider == "azure" and (
        os.getenv("REPOSHIFT_ALLOW_PAID") != "1" or not os.getenv("AZURE_OPENAI_API_KEY")
    ):
        raise RuntimeError("Paid model runs are disabled or credentials are missing")
    suite_root = {"v2": V2_ROOT, "v3": V3_ROOT, "v4": V4_ROOT}.get(suite)
    catalog = (
        ["sdk-options", "fs-promises", "sdk-wrapper", "fs-settings"]
        if suite == "v1"
        else list(json.loads((suite_root / "manifest.json").read_text())["tasks"])
    )
    manifests = {name: recipe(name) for name in catalog}
    tasks = [name for name in catalog if manifests[name]["split"] == split]
    archetypes = {name: manifests[name].get("archetype", manifests[name]["family"]) for name in tasks}
    if selected_tasks:
        if len(set(selected_tasks)) != len(selected_tasks) or not set(selected_tasks) <= set(tasks):
            raise ValueError("Selected tasks must be unique members of the requested suite and split")
        tasks = [name for name in tasks if name in selected_tasks]
    if quick:
        tasks = tasks[:1]
    if not tasks:
        raise ValueError("No benchmark tasks selected")
    configurations = ["A", "C"] if quick or compare_only else ["A", "B", "C"]
    trial_count = 1 if quick else trials
    implementation_files = {
        f"{folder}/{name}": content
        for folder in ("reposhift", "src")
        for name, content in tree(ROOT / folder).items()
    }
    implementation_files["runner/check.cjs"] = (ROOT / "runner/check.cjs").read_text()
    for name in ("runner/Dockerfile", "package-lock.json", "pyproject.toml"):
        implementation_files[name] = (ROOT / name).read_text()
    implementation_hash = snapshot(implementation_files)
    catalog_hash = digest((suite_root / "manifest.json").read_bytes()) if suite_root else None
    probe_catalog = (V4_ROOT / "probes" if suite == "v4" else PROBE_ROOT) / "manifest.json"
    probe_catalog_hash = digest(probe_catalog.read_bytes()) if probe_catalog.exists() else None
    store = Store()
    store.init()
    batch = str(uuid.uuid4())
    attempts = []
    for configuration, task, trial in scheduled_attempts(configurations, tasks, trial_count):
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
                "archetype": archetypes[task],
                "trial": trial,
                "configuration": configuration,
                "provider": provider,
                "runnerImage": result["checkpoint"].get("image"),
                "success": attempt_succeeded(result),
                "delivery": None,
                "latencyMs": int((ended - result["created_at"]).total_seconds() * 1000),
                "stateTimingsMs": stage_timings(events, result["created_at"]),
                "checkTimingsMs": check_timings(artifacts),
                "initialCheckFailed": any(
                    (item["name"] in {"build-0", "visible-0"} and item["value"]["code"] != 0)
                    or (item["name"] == "migration-0" and not item["value"]["passed"])
                    or (item["name"] == "regression-0" and not item["value"]["passed"])
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
            "suite": suite,
            "split": split,
            "selectedTasks": tasks,
            "trialsPerTask": trial_count,
            "configurations": configurations,
            "orderStrategy": "counterbalanced-by-task-and-trial",
            "implementationHash": implementation_hash,
            "catalogHash": catalog_hash,
            "probeCatalogHash": probe_catalog_hash,
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
    report["paired"] = paired_summary(attempts)
    atomic_json(ROOT / "reports/local" / f"python-benchmark-{batch}.json", report)
    return report
