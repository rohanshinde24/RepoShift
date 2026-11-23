"""Expand the v2 seed tasks with labeled, correlated parameter variants."""

import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "benchmarks" / "v2"
VARIANTS = range(2, 6)


def replace_once(path: Path, old: str, new: str):
    content = path.read_text()
    if content.count(old) != 1:
        raise ValueError(f"Expected one occurrence of {old!r} in {path}")
    path.write_text(content.replace(old, new))


def update_variant(root: Path, archetype: str, variant: int):
    if archetype == "sdk-order":
        for folder in ("base", "reference"):
            replace_once(root / folder / "src/freight.ts", "+ 1", f"+ {variant}")
        replace_once(root / "visible.cjs", 'freight: "USD:13.00"', f'freight: "USD:{12 + variant}.00"')
        replace_once(root / "hidden.cjs", "weight * rate + 1", f"weight * rate + {variant}")
    elif archetype == "sdk-subscription":
        for folder in ("base", "reference"):
            replace_once(root / folder / "src/annual.ts", "+ 1", f"+ {variant}")
        replace_once(root / "visible.cjs", '"USD:121.00"', f'"USD:{120 + variant}.00"')
        replace_once(root / "hidden.cjs", "price * 12 * years + 1", f"price * 12 * years + {variant}")
    elif archetype == "fs-profile":
        for folder in ("base", "reference"):
            replace_once(root / folder / "src/age.ts", "?? 1", f"?? {variant}")
        replace_once(root / "hidden.cjs", "age: 1", f"age: {variant}")
    elif archetype == "fs-ledger":
        replace_once(root / "base/src/ledger.ts", "+ 1", f"+ {variant}")
        replace_once(root / "visible.cjs", "total: 6", f"total: {5 + variant}")
        replace_once(root / "hidden.cjs", "total: 8", f"total: {7 + variant}")
        replace_once(root / "hidden.cjs", "total: 1,", f"total: {variant},")
    else:
        raise ValueError(f"Unknown archetype: {archetype}")


def main():
    catalog_path = ROOT / "manifest.json"
    catalog = json.loads(catalog_path.read_text())
    if catalog["status"] != "development-seed" or len(catalog["tasks"]) != 4:
        raise SystemExit("Expand only the original four development seed tasks")
    for archetype in ("sdk-order", "fs-profile", "sdk-subscription", "fs-ledger"):
        original = ROOT / "tasks" / f"{archetype}-01"
        for variant in VARIANTS:
            task_id = f"{archetype}-{variant:02d}"
            target = ROOT / "tasks" / task_id
            if target.exists():
                raise FileExistsError(target)
            shutil.copytree(original, target)
            update_variant(target, archetype, variant)
            manifest_path = target / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            manifest["id"] = task_id
            manifest["variant"] = variant
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
            catalog["tasks"][task_id] = {
                "split": manifest["split"],
                "archetype": archetype,
                "files": {
                    path.relative_to(target).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in sorted(target.rglob("*"))
                    if path.is_file()
                },
            }
    catalog["status"] = "frozen-before-model-evaluation"
    catalog["taskCount"] = len(catalog["tasks"])
    catalog["archetypeCount"] = 4
    catalog_path.write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"Created {len(catalog['tasks'])} tasks across four archetypes")


if __name__ == "__main__":
    main()
