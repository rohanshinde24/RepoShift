import hashlib
import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP = {".git", "node_modules", "dist", ".venv", "__pycache__"}


def digest(value: bytes | str) -> str:
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def tree(root: Path) -> dict[str, str]:
    result = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(part in SKIP for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError("Symlinks are forbidden")
        if path.is_dir():
            continue
        if not path.is_file() or path.stat().st_size > 256000:
            raise ValueError("Unsupported file")
        result[relative.as_posix()] = path.read_text()
    return result


def snapshot(files: dict[str, str]) -> str:
    return digest(json.dumps(sorted(files.items()), ensure_ascii=False, separators=(",", ":")))


def atomic_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(data, indent=2, default=str))
    temporary.replace(path)


def command(argv: list[str], cwd: Path | None = None, timeout: int = 120) -> dict:
    completed = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False)
    return {"code": completed.returncode, "output": (completed.stdout + completed.stderr)[-64000:]}


def git(cwd: Path, *args: str) -> str:
    env = dict(os.environ)
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT="0")
    result = subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode:
        raise RuntimeError((result.stdout + result.stderr)[-64000:])
    return result.stdout.strip()


def recipe(recipe_id: str) -> dict:
    if recipe_id not in {"sdk-options", "fs-promises", "sdk-wrapper", "fs-settings"}:
        raise ValueError("Unsupported recipe")
    root = ROOT / "fixtures" / recipe_id
    manifest = json.loads((root / "manifest.json").read_text())
    if recipe_id in {"sdk-wrapper", "fs-settings"}:
        expected = json.loads((ROOT / "benchmarks/v1/manifest.json").read_text())["tasks"][recipe_id]
        found = {}
        for folder in ("base", "reference"):
            for name in tree(root / folder):
                found[f"{folder}/{name}"] = digest((root / folder / name).read_bytes())
        for name in ("manifest.json", "visible.cjs", "hidden.cjs"):
            found[name] = digest((root / name).read_bytes())
        if found != expected:
            raise ValueError("Frozen fixture changed")
    return manifest


def validate_source(source: dict) -> None:
    repository, base_ref = source.get("repository"), source.get("baseRef")
    if not repository and not base_ref:
        return
    import re

    allowed = os.getenv("REPOSHIFT_ALLOWED_REPOSITORIES", "").split(",")
    if (
        not isinstance(repository, str)
        or not re.fullmatch(r"[-\w.]+/[-\w.]+", repository)
        or repository not in allowed
        or not isinstance(base_ref, str)
        or not re.fullmatch(r"[0-9a-f]{40}", base_ref)
    ):
        raise ValueError("Source requires an allowlisted owner/repo and immutable SHA")


def prepare_source(source: dict, manifest: dict, checkout: Path) -> None:
    validate_source(source)
    repository, base_ref = source.get("repository"), source.get("baseRef")
    if not repository:
        shutil.copytree(ROOT / "fixtures" / manifest["id"] / "base", checkout, dirs_exist_ok=True)
        return
    git(checkout, "init", "-b", "main")
    git(
        checkout,
        "-c",
        "protocol.file.allow=never",
        "fetch",
        "--depth=1",
        "--no-tags",
        "--no-recurse-submodules",
        f"https://github.com/{repository}.git",
        base_ref,
    )
    git(checkout, "checkout", "--detach", "FETCH_HEAD")
    if git(checkout, "rev-parse", "HEAD") != base_ref:
        raise ValueError("Fetched commit differs from requested source")
    files = tree(checkout)
    if any(name not in files for name in manifest["allowedFiles"]):
        raise ValueError("Recipe source files are missing")


def apply_patch(root: Path, patch: dict, allowed: list[str]) -> None:
    if not isinstance(patch, dict) or set(patch) != {"base_hash", "edits"}:
        raise ValueError("Invalid patch schema")
    before = tree(root)
    if patch["base_hash"] != snapshot(before):
        raise ValueError("Stale patch")
    edits = patch["edits"]
    if not isinstance(edits, list) or len(edits) > 20:
        raise ValueError("Invalid edits")
    seen = set()
    for edit in edits:
        if not isinstance(edit, dict) or set(edit) != {"path", "content"}:
            raise ValueError("Invalid edit")
        name, content = edit["path"], edit["content"]
        if (
            not isinstance(name, str)
            or not isinstance(content, str)
            or len(content) > 64000
            or name not in allowed
            or name not in before
            or name in seen
            or Path(name).is_absolute()
            or ".." in Path(name).parts
            or not (root / name).is_file()
            or (root / name).is_symlink()
        ):
            raise ValueError(f"Forbidden file: {name}")
        seen.add(name)
    for edit in edits:
        (root / edit["path"]).write_text(edit["content"])


def resolve_image() -> str:
    name = os.getenv("REPOSHIFT_RUNNER_IMAGE", "reposhift-runner:dev")
    result = command(["docker", "image", "inspect", name, "--format", "{{.Id}}"])
    if result["code"] or not result["output"].strip().startswith("sha256:"):
        raise RuntimeError("Build the RepoShift runner image first")
    return result["output"].strip()


def check(root: Path, recipe_id: str, phase: str, image: str) -> dict:
    name = f"reposhift-{uuid.uuid4()}"
    args = [
        "docker",
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "64",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--user",
        "1000:1000",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=128m",
        "--mount",
        f"type=bind,source={root.resolve()},target=/input,readonly",
    ]
    if phase != "build":
        fixture = ROOT / "fixtures" / recipe_id / f"{phase}.cjs"
        args += ["--mount", f"type=bind,source={fixture},target=/checks/check.cjs,readonly"]
    try:
        return command(args + [image, phase])
    finally:
        command(["docker", "rm", "-f", name], timeout=15)
