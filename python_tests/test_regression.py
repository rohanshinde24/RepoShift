import shutil

import pytest

from reposhift import regression
from reposhift.analysis import compiler
from reposhift.core import ROOT, apply_patch, check, resolve_image, snapshot, tree
from reposhift.regression import capture_probe, compare_probes


def test_differential_probe_catches_behavior_change_that_visible_tests_miss(tmp_path):
    task_id = "fs-profile-01"
    source = ROOT / "benchmarks/v2/tasks" / task_id / "base"
    shutil.copytree(source, tmp_path, dirs_exist_ok=True)
    image = resolve_image()
    baseline = capture_probe(tmp_path, task_id, image)
    age = tmp_path / "src/age.ts"
    age.write_text(age.read_text().replace("?? 1", "?? 2"))
    assert check(tmp_path, task_id, "build", image)["code"] == 0
    assert check(tmp_path, task_id, "visible", image)["code"] == 0
    result = compare_probes(baseline, capture_probe(tmp_path, task_id, image))
    assert result["passed"] is False
    assert '"case":"age-default"' in result["diagnostic"]


def test_differential_diagnostic_explains_lost_rejection():
    baseline = {"missing": {"ok": False, "name": "Error", "code": "ENOENT"}}
    migrated = {"missing": {"ok": True, "value": 0}}
    result = compare_probes(baseline, migrated)
    assert result["passed"] is False
    assert result["failureKind"] == "lost-rejection"
    assert "Preserve the rejection and its error code" in result["diagnostic"]


def test_probe_stdout_diagnostic_identifies_logging(monkeypatch, tmp_path):
    monkeypatch.setattr(
        regression,
        "check",
        lambda *_: {"code": 0, "output": 'debug output\\n{"cases":[]}'},
    )
    with pytest.raises(ValueError, match="Remove stdout logging"):
        capture_probe(tmp_path, "fs-metrics-01", "runner")


def test_differential_diagnostic_explains_lost_success():
    baseline = {"empty": {"ok": True, "value": []}}
    migrated = {"empty": {"ok": False, "name": "Error", "code": None}}
    result = compare_probes(baseline, migrated)
    assert "original accepted this input" in result["diagnostic"]


def test_differential_diagnostic_classifies_error_wrapping():
    baseline = {"missing": {"ok": False, "name": "Error", "code": "ENOENT"}}
    migrated = {"missing": {"ok": False, "name": "Error", "code": None}}
    result = compare_probes(baseline, migrated)
    assert result["failureKind"] == "error-change"
    assert "Rethrow caught errors" in result["diagnostic"]


def test_typed_repair_restores_rejection_and_passes_hidden_checks(tmp_path):
    task_id = "fs-ledger-01"
    root = ROOT / "benchmarks/v2/tasks" / task_id
    shutil.copytree(root / "base", tmp_path, dirs_exist_ok=True)
    before = tree(tmp_path)
    image = resolve_image()
    baseline = capture_probe(tmp_path, task_id, image)
    for name, content in tree(root / "reference").items():
        (tmp_path / name).write_text(content)
    reader = tmp_path / "src/reader.ts"
    reader.write_text(
        'import { readFile } from "node:fs/promises";\n'
        "export async function readText(path: string): Promise<string> {\n"
        '  try { return await readFile(path, "utf8"); }\n'
        '  catch (error) { return ""; }\n'
        "}\n"
    )
    assert check(tmp_path, task_id, "build", image)["code"] == 0
    assert check(tmp_path, task_id, "visible", image)["code"] == 0
    assert check(tmp_path, task_id, "hidden", image)["code"] != 0
    regression = compare_probes(baseline, capture_probe(tmp_path, task_id, image))
    assert regression["failureKind"] == "lost-rejection"
    current = tree(tmp_path)
    edit = compiler("repair-fallback-catch", before=before, after=current, allowed=["src/reader.ts"])
    assert edit["path"] == "src/reader.ts"
    apply_patch(tmp_path, {"base_hash": snapshot(current), "edits": [edit]}, ["src/reader.ts"])
    assert compare_probes(baseline, capture_probe(tmp_path, task_id, image))["passed"] is True
    assert check(tmp_path, task_id, "hidden", image)["code"] == 0
