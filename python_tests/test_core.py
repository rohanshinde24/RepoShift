import json
from pathlib import Path

import pytest

from reposhift import core
from reposhift.analysis import compiler, plan
from reposhift.core import (
    ROOT,
    V2_ROOT,
    V3_ROOT,
    V4_ROOT,
    apply_patch,
    recipe,
    snapshot,
    tree,
    validate_reference_source,
)


def test_snapshot_matches_compiler_fixture_and_rejects_unsafe_patches(tmp_path: Path):
    base = tree(ROOT / "fixtures/sdk-options/base")
    assert snapshot(base) == "be2761f93a92ba5cacade146d44dcc9dadd6b5a5f1d8b7ff6a3ad4418ef7c26a"
    root = tmp_path / "checkout"
    for name, content in base.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    with pytest.raises(ValueError, match="Forbidden file"):
        apply_patch(
            root,
            {"base_hash": snapshot(base), "edits": [{"path": "../outside", "content": "bad"}]},
            ["src/retail.ts"],
        )
    assert tree(root) == base
    with pytest.raises(ValueError, match="Stale patch"):
        apply_patch(root, {"base_hash": "wrong", "edits": []}, ["src/retail.ts"])


def test_docker_check_reports_elapsed_time_including_cleanup(monkeypatch, tmp_path):
    calls = []

    def fake_command(argv, timeout=120):
        calls.append(argv)
        return {"code": 0, "output": ""}

    monkeypatch.setattr(core, "command", fake_command)
    result = core.check(tmp_path, "sdk-options", "build", "runner")
    assert result["code"] == 0
    assert isinstance(result["durationMs"], int)
    assert result["durationMs"] >= 0
    assert calls[0][:2] == ["docker", "run"]
    assert calls[1][:3] == ["docker", "rm", "-f"]


def test_external_reference_requires_exact_frozen_base():
    manifest = recipe("sdk-options")
    files = tree(ROOT / "fixtures/sdk-options/base")
    source = {"repository": "owner/repo", "provider": "reference"}
    validate_reference_source(source, manifest, files)
    changed = {**files, "src/retail.ts": files["src/retail.ts"] + "\n// different source"}
    with pytest.raises(ValueError, match="exact frozen base"):
        validate_reference_source(source, manifest, changed)
    validate_reference_source({**source, "provider": "ollama"}, manifest, changed)


def test_python_dag_uses_compiler_edges():
    root = ROOT / "fixtures/sdk-options/base"
    graph = compiler("analyze", root=str(root))
    tasks = plan(graph, recipe("sdk-options"))
    assert any(task["files"] == ["src/retail.ts"] for task in tasks)
    assert any(task["files"] == ["src/wholesale.ts"] for task in tasks)
    assert compiler("assert", files=tree(root), recipe=recipe("sdk-options")) is False


def test_v2_catalog_is_frozen_and_splits_archetypes():
    catalog = json.loads((V2_ROOT / "manifest.json").read_text())
    assert len(catalog["tasks"]) == 20
    archetypes = {"development": set(), "held-out": set()}
    for task_id, entry in catalog["tasks"].items():
        manifest = recipe(task_id)
        assert core.probe_path(task_id).is_file()
        assert manifest["split"] == entry["split"]
        assert manifest["archetype"] == entry["archetype"]
        archetypes[entry["split"]].add(entry["archetype"])
    assert len(archetypes["development"]) == len(archetypes["held-out"]) == 2
    assert archetypes["development"].isdisjoint(archetypes["held-out"])


def test_v2_probe_catalog_cannot_be_silently_removed(monkeypatch, tmp_path):
    monkeypatch.setattr(core, "PROBE_ROOT", tmp_path)
    with pytest.raises(ValueError, match="Regression probe catalog is missing"):
        core.probe_path("fs-profile-01")


def test_v3_catalog_has_distinct_frozen_archetypes():
    catalog = json.loads((V3_ROOT / "manifest.json").read_text())
    assert len(catalog["tasks"]) == 6
    archetypes = {"development": set(), "held-out": set()}
    for task_id, entry in catalog["tasks"].items():
        manifest = recipe(task_id)
        assert core.probe_path(task_id).is_file()
        assert manifest["split"] == entry["split"]
        assert manifest["archetype"] == entry["archetype"]
        archetypes[entry["split"]].add(entry["archetype"])
    assert len(archetypes["development"]) == len(archetypes["held-out"]) == 3
    assert archetypes["development"].isdisjoint(archetypes["held-out"])


def test_v4_catalog_has_frozen_tasks_and_separate_probes():
    catalog = json.loads((V4_ROOT / "manifest.json").read_text())
    assert len(catalog["tasks"]) == 12
    archetypes = {"development": set(), "held-out": set()}
    for task_id, entry in catalog["tasks"].items():
        manifest = recipe(task_id)
        assert core.probe_path(task_id).parent == V4_ROOT / "probes"
        assert manifest["split"] == entry["split"]
        assert manifest["archetype"] == entry["archetype"]
        archetypes[entry["split"]].add(entry["archetype"])
    assert len(archetypes["development"]) == 4
    assert len(archetypes["held-out"]) == 8
    assert archetypes["development"].isdisjoint(archetypes["held-out"])


def test_compiler_reports_new_fallback_catch_file():
    before = {"src/reader.ts": "export const read = () => Promise.resolve('ok');"}
    after = {"src/reader.ts": "export const read = () => Promise.resolve('ok').catch(e => null);"}
    assert compiler("fallback-catches", before=before, after=after, allowed=["src/reader.ts"]) == [
        "src/reader.ts"
    ]


def test_compiler_repairs_single_fallback_catch():
    before = {"src/reader.ts": "export function read() { return load(); }"}
    after = {
        "src/reader.ts": "export function read() { try { return load(); } catch (error) { return null; } }"
    }
    result = compiler("repair-fallback-catch", before=before, after=after, allowed=["src/reader.ts"])
    assert result == {
        "path": "src/reader.ts",
        "content": "export function read() { try { return load(); } catch (error) { throw error; } }",
    }


def test_compiler_repairs_single_arrow_catch_fallback():
    before = {"src/reader.ts": "export const read = () => load();"}
    after = {"src/reader.ts": "export const read = () => load().catch(error => null);"}
    result = compiler("repair-fallback-catch", before=before, after=after, allowed=["src/reader.ts"])
    assert result == {
        "path": "src/reader.ts",
        "content": "export const read = () => load().catch(error => { throw error; });",
    }
