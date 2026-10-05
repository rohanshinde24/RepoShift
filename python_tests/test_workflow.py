import time
import uuid
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import pytest

from reposhift.store import Store
from reposhift.workflow import execute


def isolated_url(base: str, schema: str) -> str:
    parts = urlsplit(base)
    query = dict(parse_qsl(parts.query))
    query["options"] = f"-c search_path={schema}"
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query, quote_via=quote), parts.fragment)
    )


@pytest.mark.parametrize("recipe_id", ["sdk-options", "fs-promises"])
def test_python_workflow_completes_verified_reference_run(monkeypatch, recipe_id):
    admin = Store()
    schema = "py_test_" + uuid.uuid4().hex
    with admin.connect() as conn:
        conn.execute(f"CREATE SCHEMA {schema}")
    try:
        url = isolated_url(admin.url, schema)
        monkeypatch.setenv("DATABASE_URL", url)
        store = Store(url)
        store.init()
        submitted = store.submit(
            {"recipe": recipe_id, "provider": "reference", "configuration": "C"},
            str(uuid.uuid4()),
        )
        run = store.claim(str(uuid.uuid4()), submitted["id"])
        result = execute(store, run)
        assert result["state"] == "COMPLETE", result["error"]
        assert result["checkpoint"]["verification"]["passed"] is True
        assert result["checkpoint"]["requests"] == 0
        states = [event["state"] for event in store.events(run["id"])]
        assert {"ANALYZE", "PLAN", "EXECUTE", "BUILD", "TEST", "VERIFY", "COMPLETE"} <= set(states)
    finally:
        with admin.connect() as conn:
            conn.execute(f"DROP SCHEMA {schema} CASCADE")


def test_expired_task_owner_cannot_write_after_replacement(monkeypatch):
    admin = Store()
    schema = "py_test_" + uuid.uuid4().hex
    with admin.connect() as conn:
        conn.execute(f"CREATE SCHEMA {schema}")
    try:
        url = isolated_url(admin.url, schema)
        monkeypatch.setenv("DATABASE_URL", url)
        store = Store(url)
        store.init()
        submitted = store.submit({"recipe": "sdk-options", "provider": "reference"}, str(uuid.uuid4()))
        run = store.claim("coordinator", submitted["id"])
        store.save(run, "EXECUTE")
        store.enqueue(run, "migration", {"recipe": "sdk-options", "files": {}, "allowed": []})
        first = store.claim_task(run["id"], "worker-one", lease_ms=1000)
        assert first["fence"] == 1
        time.sleep(1.1)
        second = store.claim_task(run["id"], "worker-two", lease_ms=1000)
        assert second["fence"] == 2
        patch = {"base_hash": "x", "edits": []}
        store.finish_task(second, patch)
        with pytest.raises(RuntimeError, match="Task lease lost"):
            store.finish_task(first, patch)
        assert store.task(run["id"], "migration")["result"] == patch
    finally:
        with admin.connect() as conn:
            conn.execute(f"DROP SCHEMA {schema} CASCADE")
