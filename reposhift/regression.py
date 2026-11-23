"""Compare public behavior before and after a migration using the same probe inputs."""

import json
from pathlib import Path

from .core import check


def capture_probe(root: Path, recipe_id: str, image: str) -> dict[str, object]:
    result = check(root, recipe_id, "probe", image)
    if result["code"]:
        raise RuntimeError(f"Regression probe failed: {result['output'][-2000:]}")
    try:
        observations = json.loads(result["output"])
    except json.JSONDecodeError as exc:
        raise ValueError(
            "Regression probe returned invalid JSON. Remove stdout logging from migrated code. "
            f"Probe output: {result['output'][-500:]!r}"
        ) from exc
    if not isinstance(observations, dict) or set(observations) != {"cases"}:
        raise ValueError("Regression probe returned an invalid envelope")
    rows = observations["cases"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= 32:
        raise ValueError("Regression probe returned an invalid case count")
    cases = {}
    for row in rows:
        if (
            not isinstance(row, dict)
            or set(row) != {"id", "result"}
            or not isinstance(row["id"], str)
            or not row["id"]
            or len(row["id"]) > 80
            or row["id"] in cases
            or not isinstance(row["result"], dict)
            or not isinstance(row["result"].get("ok"), bool)
        ):
            raise ValueError("Regression probe returned an invalid case")
        cases[row["id"]] = row["result"]
    return cases


def compare_probes(before: dict, after: dict) -> dict:
    if set(before) != set(after):
        return {
            "passed": False,
            "cases": len(before),
            "failureKind": "case-set-change",
            "diagnostic": "Regression probe returned different case identifiers",
        }
    for name in before:
        if before[name] != after[name]:
            hint = ""
            failure_kind = "value-change"
            if before[name].get("ok") is False and after[name].get("ok") is True:
                failure_kind = "lost-rejection"
                hint = (
                    " The original rejected this input, but the migration returned a value. "
                    "Preserve the rejection and its error code. "
                    "Check catch handlers that return fallback values."
                )
            elif before[name].get("ok") is True and after[name].get("ok") is False:
                hint = " The original accepted this input. Preserve its successful result."
            elif before[name].get("ok") is False and after[name].get("ok") is False:
                failure_kind = "error-change"
                hint = (
                    " Preserve the original error class and code. "
                    "Rethrow caught errors instead of wrapping them in a new Error."
                )
            detail = json.dumps(
                {"case": name, "expected": before[name], "actual": after[name]},
                ensure_ascii=False,
                separators=(",", ":"),
            )
            return {
                "passed": False,
                "cases": len(before),
                "failureKind": failure_kind,
                "diagnostic": f"Behavior changed for the same input: {detail[:4000]}{hint}",
            }
    return {"passed": True, "cases": len(before), "failureKind": None, "diagnostic": ""}
