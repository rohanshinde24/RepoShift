import json

import httpx
import pytest

from reposhift.core import ROOT, snapshot, tree
from reposhift.provider import propose


class Accounting:
    def __init__(self):
        self.reservations = []
        self.usage = []

    def reserve_model(self, _run, _task, tokens):
        self.reservations.append(tokens)
        return "reservation"

    def complete_model(self, reservation, usage):
        assert reservation == "reservation"
        self.usage.append(usage)


def task_input(provider):
    files = tree(ROOT / "fixtures/sdk-options/base")
    return (
        {"input": {"provider": provider}},
        {"payload": {"recipe": "sdk-options", "files": files, "allowed": ["src/retail.ts"]}},
    )


def test_local_provider_rejects_invalid_path_and_records_usage(monkeypatch):
    run, task = task_input("ollama")
    accounting = Accounting()
    hash_value = snapshot(task["payload"]["files"])

    def response(_url, **kwargs):
        assert kwargs["json"]["format"]["properties"]["edits"]["items"]["properties"]["path"]["enum"] == [
            "src/retail.ts"
        ]
        return httpx.Response(
            200,
            request=httpx.Request("POST", _url),
            json={
                "model": "local-test",
                "prompt_eval_count": 10,
                "eval_count": 5,
                "message": {
                    "content": json.dumps(
                        {"base_hash": hash_value, "edits": [{"path": "src/retail.ts", "content": "updated"}]}
                    )
                },
            },
        )

    monkeypatch.setattr(httpx, "post", response)
    patch = propose(accounting, run, task)
    assert patch["edits"][0]["content"] == "updated"
    assert accounting.usage[0]["input"] == 10
    assert len(accounting.reservations) == 1


def test_azure_requires_paid_opt_in_before_network(monkeypatch):
    monkeypatch.delenv("REPOSHIFT_ALLOW_PAID", raising=False)
    run, task = task_input("azure")
    with pytest.raises(RuntimeError, match="disabled"):
        propose(Accounting(), run, task)


def test_caller_without_old_sdk_is_left_unchanged_without_model_call(monkeypatch):
    run, task = task_input("ollama")
    task["payload"]["allowed"] = ["src/service.ts"]
    accounting = Accounting()

    def unexpected(*_args, **_kwargs):
        raise AssertionError("Model should not be called for an unaffected caller")

    monkeypatch.setattr(httpx, "post", unexpected)
    patch = propose(accounting, run, task)
    assert patch["edits"] == []
    assert accounting.reservations == []
