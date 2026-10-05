import json
import subprocess

from .core import ROOT


def compiler(action: str, **kwargs):
    helper = ROOT / "dist" / "src" / "python-helper.js"
    if not helper.exists():
        raise RuntimeError("Run npm run build to prepare the TypeScript parser helper")
    result = subprocess.run(
        ["node", str(helper)],
        input=json.dumps({"action": action, **kwargs}),
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return json.loads(result.stdout)


def targeted_context(graph: dict, files: dict, owned: list[str]) -> dict:
    selected = set(owned)
    for edge in graph["edges"]:
        if edge["to"] in owned:
            selected.add(edge["from"])
    changed = True
    while changed:
        changed = False
        for edge in graph["edges"]:
            if edge["from"] in selected and edge["to"] not in selected:
                selected.add(edge["to"])
                changed = True
    selected.update(name for name in files if name.startswith("lib/"))
    return {name: content for name, content in files.items() if name in selected}


def plan(graph: dict, manifest: dict) -> list[dict]:
    affected = set(manifest["seedFiles"])
    changed = True
    while changed:
        changed = False
        for edge in graph["edges"]:
            if edge["to"] in affected and edge["from"] not in affected:
                affected.add(edge["from"])
                changed = True
    files = sorted(set(graph["files"]) & affected & set(manifest["allowedFiles"]))
    adjacency = {name: [] for name in files}
    for edge in graph["edges"]:
        if edge["from"] in adjacency and edge["to"] in adjacency:
            adjacency[edge["from"]].append(edge["to"])
    index = 0
    indices, low, stack, on_stack, groups = {}, {}, [], set(), []

    def visit(name):
        nonlocal index
        indices[name] = low[name] = index
        index += 1
        stack.append(name)
        on_stack.add(name)
        for dependency in adjacency[name]:
            if dependency not in indices:
                visit(dependency)
                low[name] = min(low[name], low[dependency])
            elif dependency in on_stack:
                low[name] = min(low[name], indices[dependency])
        if low[name] == indices[name]:
            group = []
            while True:
                member = stack.pop()
                on_stack.remove(member)
                group.append(member)
                if member == name:
                    break
            groups.append(sorted(group))

    for name in files:
        if name not in indices:
            visit(name)
    if len(groups) > 10:
        raise ValueError("Too many migration tasks")
    tasks = [{"id": f"task-{i}", "files": group, "dependsOn": []} for i, group in enumerate(groups)]
    for task in tasks:
        task["dependsOn"] = [
            other["id"]
            for other in tasks
            if other != task
            and any(dep in other["files"] for name in task["files"] for dep in adjacency[name])
        ]
    return tasks
