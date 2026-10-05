import base64
import os
import re
from urllib.parse import quote

import httpx

from .core import digest


def publish(run_id: str, recipe_id: str, before: dict, after: dict) -> str:
    repository = os.getenv("REPOSHIFT_GITHUB_REPOSITORY", "")
    token = os.getenv("GITHUB_TOKEN", "")
    if not re.fullmatch(r"[-\w.]+/[-\w.]+", repository) or not token:
        raise ValueError("Configure an authorized GitHub repository and token")
    branch = f"reposhift/{run_id}"
    head = quote(repository.split("/")[0] + ":" + branch, safe="")
    client = httpx.Client(
        base_url=f"https://api.github.com/repos/{repository}",
        timeout=30,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )

    def api(route: str, method="GET", payload=None, missing=False):
        response = client.request(method, route, json=payload)
        if missing and response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    try:
        prior = api(f"/pulls?state=all&head={head}")
        if prior:
            return prior[0]["html_url"]
        base_branch = api("")["default_branch"]
        base = api(f"/git/ref/heads/{quote(base_branch, safe='')}")["object"]["sha"]
        commit = api(f"/git/commits/{base}")
        for name, content in before.items():
            remote = api(f"/contents/{quote(name, safe='/')}?ref={base}")
            if remote.get("encoding") != "base64" or digest(base64.b64decode(remote["content"])) != digest(
                content
            ):
                raise ValueError("Remote base differs from verified source")
        changed = [
            {"path": name, "mode": "100644", "type": "blob", "content": content}
            for name, content in after.items()
            if before.get(name) != content
        ]
        target_tree = api("/git/trees", "POST", {"base_tree": commit["tree"]["sha"], "tree": changed})["sha"]
        ref = api(f"/git/ref/heads/{quote(branch, safe='')}", missing=True)
        if ref:
            current = api(f"/git/commits/{ref['object']['sha']}")
            if current["tree"]["sha"] != target_tree:
                raise ValueError("Existing publication branch differs from verified patch")
        else:
            created = api(
                "/git/commits",
                "POST",
                {
                    "message": f"RepoShift: {recipe_id}\n\nRun: {run_id}",
                    "tree": target_tree,
                    "parents": [base],
                },
            )
            api("/git/refs", "POST", {"ref": f"refs/heads/{branch}", "sha": created["sha"]})
        prior = api(f"/pulls?state=all&head={head}")
        if prior:
            return prior[0]["html_url"]
        created = api(
            "/pulls",
            "POST",
            {
                "title": f"RepoShift: {recipe_id}",
                "head": branch,
                "base": base_branch,
                "draft": True,
                "body": f"Verified migration for run {run_id}.\n\n"
                "Build, visible tests, hidden tests, migration assertions and forbidden-file "
                "checks passed.\n\nThis development-fixture run is not a benchmark result.\n\n"
                f"<!-- reposhift:{run_id} -->",
            },
        )
        return created["html_url"]
    finally:
        client.close()
