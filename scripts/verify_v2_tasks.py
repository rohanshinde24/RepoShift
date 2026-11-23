"""Validate frozen versioned sources, references, and task-specific checks."""

import argparse
import json
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from reposhift.analysis import compiler
from reposhift.core import (
    ROOT,
    atomic_json,
    check,
    digest,
    probe_path,
    recipe,
    recipe_root,
    resolve_image,
    tree,
)
from reposhift.regression import capture_probe, compare_probes


def main(selected_tasks=None, suite="v2"):
    if suite not in {"v2", "v3", "v4"}:
        raise ValueError("Choose v2, v3, or v4")
    catalog = json.loads((ROOT / f"benchmarks/{suite}/manifest.json").read_text())
    tasks = selected_tasks or list(catalog["tasks"])
    if len(set(tasks)) != len(tasks) or not set(tasks) <= set(catalog["tasks"]):
        raise ValueError(f"Selected tasks must be unique members of the {suite} catalog")
    image = resolve_image()
    results = []
    for task_id in tasks:
        manifest = recipe(task_id)
        root = recipe_root(task_id)
        with TemporaryDirectory(prefix=f"reposhift-{suite}-") as folder:
            work = Path(folder)
            shutil.copytree(root / "base", work, dirs_exist_ok=True)
            before = tree(work)
            if compiler("assert", files=before, recipe=manifest):
                raise ValueError(f"{task_id} base is already migrated")
            for phase in ("build", "visible"):
                result = check(work, task_id, phase, image)
                if result["code"]:
                    raise ValueError(f"{task_id} base {phase} failed: {result['output'][-2000:]}")
            if probe_path(task_id) is None:
                raise ValueError(f"{task_id} has no regression probe")
            baseline_probe = capture_probe(work, task_id, image)
            for name, content in tree(root / "reference").items():
                if name not in manifest["allowedFiles"] or name not in before:
                    raise ValueError(f"{task_id} reference edits a forbidden file: {name}")
                (work / name).write_text(content)
            after = tree(work)
            if not compiler("assert", files=after, recipe=manifest):
                raise ValueError(f"{task_id} reference fails migration assertions")
            for phase in ("build", "visible", "hidden"):
                result = check(work, task_id, phase, image)
                if result["code"]:
                    raise ValueError(f"{task_id} reference {phase} failed: {result['output'][-2000:]}")
            regression = compare_probes(baseline_probe, capture_probe(work, task_id, image))
            if not regression["passed"]:
                raise ValueError(f"{task_id} reference changed behavior: {regression['diagnostic']}")
            results.append(
                {
                    "task": task_id,
                    "archetype": manifest["archetype"],
                    "passed": True,
                    "regressionCases": regression["cases"],
                }
            )
            print(f"{task_id}: validated", flush=True)
    suffix = "all" if selected_tasks is None else "selected-" + digest(json.dumps(tasks))[:12]
    atomic_json(
        ROOT / "reports/local" / f"{suite}-fixture-validation-{suffix}.json",
        {"kind": "deterministic-fixture-validation-not-model-evaluation", "results": results},
    )
    print(f"Validated {len(results)} tasks across {len({x['archetype'] for x in results})} archetypes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", action="append")
    parser.add_argument("--suite", choices=["v2", "v3", "v4"], default="v2")
    args = parser.parse_args()
    main(args.task, args.suite)
