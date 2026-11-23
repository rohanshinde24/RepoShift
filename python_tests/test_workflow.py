import threading
import time
import uuid
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import pytest

from reposhift.store import Store
from reposhift.workflow import _task_heartbeat, execute, patch_changes_files


def test_repair_change_check_rejects_unchanged_file_content():
    files = {"src/reader.ts": "before", "src/caller.ts": "caller"}
    assert not patch_changes_files(files, {"edits": []})
    assert not patch_changes_files(files, {"edits": [{"path": "src/reader.ts", "content": "before"}]})
    assert patch_changes_files(files, {"edits": [{"path": "src/reader.ts", "content": "after"}]})


def isolated_url(base: str, schema: str) -> str:
    parts = urlsplit(base)
    query = dict(parse_qsl(parts.query))
    query["options"] = f"-c search_path={schema}"
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query, quote_via=quote), parts.fragment)
    )


@pytest.mark.parametrize("recipe_id", ["sdk-options", "fs-promises", "fs-profile-01"])
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
        assert result["checkpoint"]["verification"]["regression"] is (
            True if recipe_id == "fs-profile-01" else None
        )
        assert result["checkpoint"]["requests"] == 0
        assert (
            next(
                artifact["value"]["passed"]
                for artifact in store.artifacts(run["id"])
                if artifact["name"] == "migration-0"
            )
            is True
        )
        if recipe_id == "fs-profile-01":
            assert (
                next(
                    artifact["value"]["passed"]
                    for artifact in store.artifacts(run["id"])
                    if artifact["name"] == "regression-0"
                )
                is True
            )
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


def test_slow_task_keeps_lease_after_transient_heartbeat_error(monkeypatch, caplog):
    admin = Store()
    schema = "py_test_" + uuid.uuid4().hex
    with admin.connect() as conn:
        conn.execute(f"CREATE SCHEMA {schema}")
    stop = threading.Event()
    heartbeat = None
    try:
        url = isolated_url(admin.url, schema)
        monkeypatch.setenv("DATABASE_URL", url)
        store = Store(url)
        store.init()
        submitted = store.submit({"recipe": "sdk-options", "provider": "ollama"}, str(uuid.uuid4()))
        run = store.claim("coordinator", submitted["id"])
        store.save(run, "EXECUTE")
        store.enqueue(run, "slow-model", {"recipe": "sdk-options", "files": {}, "allowed": []})
        task = store.claim_task(run["id"], "worker-one", lease_ms=600)

        class FlakyHeartbeat:
            calls = 0

            def heartbeat_task(self, claimed, lease_ms):
                self.calls += 1
                if self.calls == 1:
                    raise OSError("temporary database error")
                store.heartbeat_task(claimed, lease_ms=lease_ms)

        flaky = FlakyHeartbeat()
        errors = []
        heartbeat = threading.Thread(
            target=_task_heartbeat,
            args=(stop, flaky, task, errors),
            kwargs={"lease_ms": 600, "interval": 0.1, "retry_interval": 0.05},
        )
        heartbeat.start()
        time.sleep(1.4)
        assert flaky.calls > 2
        assert not errors
        assert not stop.is_set()
        assert store.claim_task(run["id"], "worker-two", lease_ms=600) is None
        patch = {"base_hash": "x", "edits": []}
        store.finish_task(task, patch)
        assert store.task(run["id"], "slow-model")["attempts"] == 1
        assert "temporary database error" in caplog.text
    finally:
        stop.set()
        if heartbeat:
            heartbeat.join(timeout=2)
        with admin.connect() as conn:
            conn.execute(f"DROP SCHEMA {schema} CASCADE")
