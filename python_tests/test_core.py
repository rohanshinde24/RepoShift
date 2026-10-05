from pathlib import Path

import pytest

from reposhift.analysis import compiler, plan
from reposhift.core import ROOT, apply_patch, recipe, snapshot, tree


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


def test_python_dag_uses_compiler_edges():
    root = ROOT / "fixtures/sdk-options/base"
    graph = compiler("analyze", root=str(root))
    tasks = plan(graph, recipe("sdk-options"))
    assert any(task["files"] == ["src/retail.ts"] for task in tasks)
    assert any(task["files"] == ["src/wholesale.ts"] for task in tasks)
    assert compiler("assert", files=tree(root), recipe=recipe("sdk-options")) is False
