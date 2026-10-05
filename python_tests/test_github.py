import base64
import json

import httpx
import pytest

from reposhift.github import publish


def test_python_publisher_reconciles_lost_pr_response(monkeypatch):
    monkeypatch.setenv("REPOSHIFT_GITHUB_REPOSITORY", "operator/demo")
    monkeypatch.setenv("GITHUB_TOKEN", "test-only")
    state = {"branch": False, "pr": False, "creates": 0}

    def handle(request):
        route = request.url.path.removeprefix("/repos/operator/demo")
        method = request.method
        if route == "/pulls" and method == "GET":
            body = [{"html_url": "https://github.com/operator/demo/pull/1"}] if state["pr"] else []
        elif route in {"", "/"}:
            body = {"default_branch": "main"}
        elif route == "/git/ref/heads/main":
            body = {"object": {"sha": "base"}}
        elif route == "/git/commits/base":
            body = {"tree": {"sha": "base-tree"}}
        elif route == "/contents/source.ts":
            body = {"encoding": "base64", "content": base64.b64encode(b"before").decode()}
        elif route == "/git/trees":
            body = {"sha": "target-tree"}
        elif route.startswith("/git/ref/heads/"):
            if not state["branch"]:
                return httpx.Response(404, json={})
            body = {"object": {"sha": "target-commit"}}
        elif route == "/git/commits" and method == "POST":
            body = {"sha": "target-commit"}
        elif route == "/git/refs":
            state["branch"] = True
            body = {"object": {"sha": "target-commit"}}
        elif route == "/git/commits/target-commit":
            body = {"tree": {"sha": "target-tree"}}
        elif route == "/pulls" and method == "POST":
            state["creates"] += 1
            state["pr"] = True
            raise httpx.ReadError("Injected response loss")
        else:
            raise AssertionError(f"Unexpected request {method} {route}")
        return httpx.Response(200, content=json.dumps(body))

    real_client = httpx.Client
    transport = httpx.MockTransport(handle)
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: real_client(transport=transport, **kwargs))
    with pytest.raises(httpx.ReadError, match="response loss"):
        publish("run", "sdk-options", {"source.ts": "before"}, {"source.ts": "after"})
    assert (
        publish("run", "sdk-options", {"source.ts": "before"}, {"source.ts": "after"})
        == "https://github.com/operator/demo/pull/1"
    )
    assert state["creates"] == 1
