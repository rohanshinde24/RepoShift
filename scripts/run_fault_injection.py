"""Exercise PostgreSQL fences under seeded retry and worker failure schedules."""

import argparse
import json
import random
import uuid
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from reposhift.core import ROOT, apply_patch, atomic_json, snapshot, tree
from reposhift.store import Store


def isolated_url(base: str, schema: str) -> str:
    parts = urlsplit(base)
    query = dict(parse_qsl(parts.query))
    query["options"] = f"-c search_path={schema}"
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query, quote_via=quote), parts.fragment)
    )


def rejects(action) -> bool:
    try:
        action()
    except RuntimeError:
        return True
    return False


def scenario(store: Store, index: int, rng: random.Random) -> dict:
    kind = ("duplicate_request", "worker_expiry", "coordinator_expiry", "cancellation")[index % 4]
    key = f"fault-{index}-{rng.getrandbits(64):016x}"
    data = {"recipe": "sdk-options", "provider": "reference", "configuration": "C"}
    submitted = store.submit(data, key)
    if store.submit(data, key)["id"] != submitted["id"]:
        raise AssertionError("Duplicate submission created a second run")
    run = store.claim(f"coordinator-{index}", submitted["id"])
    store.save(run, "EXECUTE")
    payload = {"recipe": "sdk-options", "files": {}, "allowed": []}
    store.enqueue(run, "migration", payload)
    store.enqueue(run, "migration", payload)
    first = store.claim_task(run["id"], f"worker-a-{index}", lease_ms=30000)
    if not first:
        raise AssertionError("Initial task claim failed")
    with TemporaryDirectory(prefix="reposhift-fault-") as folder:
        source = Path(folder)
        (source / "src").mkdir()
        (source / "src/index.ts").write_text(f"before-{index}")
        patch = {
            "base_hash": snapshot(tree(source)),
            "edits": [{"path": "src/index.ts", "content": f"after-{index}"}],
        }
        result = complete_scenario(store, index, rng, kind, run, first, payload, patch, source)
    return result


def complete_scenario(store, index, rng, kind, run, first, payload, patch, source):
    stale_rejected = False
    expected_accepted = 1
    if kind == "worker_expiry":
        store.one(
            "UPDATE tasks SET lease_until=now()-interval '1 second' WHERE run_id=%s AND id=%s RETURNING id",
            (run["id"], first["id"]),
        )
        second = store.claim_task(run["id"], f"worker-b-{index}")
        if not second or second["fence"] <= first["fence"]:
            raise AssertionError("Expired task was not reclaimed with a new fence")
        if rng.randrange(2):
            stale_rejected = rejects(lambda: store.finish_task(first, patch))
            store.finish_task(second, patch)
        else:
            store.finish_task(second, patch)
            stale_rejected = rejects(lambda: store.finish_task(first, patch))
    elif kind == "coordinator_expiry":
        store.one(
            "UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=%s RETURNING id",
            (run["id"],),
        )
        replacement = store.claim(f"replacement-{index}", run["id"])
        store.save(replacement, "EXECUTE")
        store.enqueue(replacement, "migration", payload)
        second = store.claim_task(run["id"], f"worker-b-{index}")
        if not second or second["run_fence"] <= first["run_fence"]:
            raise AssertionError("Task did not follow the replacement coordinator")
        stale_rejected = rejects(lambda: store.finish_task(first, patch))
        store.finish_task(second, patch)
        if not rejects(lambda: store.save(run, "BUILD")):
            raise AssertionError("Expired coordinator wrote workflow state")
    elif kind == "cancellation":
        store.cancel(run["id"])
        stale_rejected = rejects(lambda: store.finish_task(first, patch))
        expected_accepted = 0
    else:
        store.finish_task(first, patch)
        stale_rejected = rejects(lambda: store.finish_task(first, patch))
        store.enqueue(run, "migration", payload)
        if store.task(run["id"], "migration")["result"] != patch:
            raise AssertionError("Duplicate enqueue replaced accepted result")
    successes = sum(event["state"] == "TASK_SUCCEEDED" for event in store.events(run["id"]))
    task = store.task(run["id"], "migration")
    if not stale_rejected or successes != expected_accepted:
        raise AssertionError(f"{kind}: stale write accepted or duplicate result recorded")
    if expected_accepted and (task["state"] != "SUCCEEDED" or task["result"] != patch):
        raise AssertionError(f"{kind}: accepted task result changed")
    if not expected_accepted and task["result"] is not None:
        raise AssertionError("Cancellation left an accepted task result")
    patch_replay_rejected = None
    if expected_accepted:
        apply_patch(source, task["result"], ["src/index.ts"])
        try:
            apply_patch(source, task["result"], ["src/index.ts"])
        except ValueError as exc:
            patch_replay_rejected = str(exc) == "Stale patch"
        if not patch_replay_rejected or (source / "src/index.ts").read_text() != f"after-{index}":
            raise AssertionError("Patch replay changed the checkout")
    return {
        "scenario": kind,
        "acceptedTaskResults": successes,
        "staleWriteRejected": True,
        "patchReplayRejected": patch_replay_rejected,
    }


def run(count: int = 1000, seed: int = 20261121) -> dict:
    if count < 1:
        raise ValueError("Scenario count must be positive")
    admin = Store()
    schema = "fault_" + uuid.uuid4().hex
    with admin.connect() as conn:
        conn.execute(f"CREATE SCHEMA {schema}")
    try:
        store = Store(isolated_url(admin.url, schema))
        store.init()
        rng = random.Random(seed)
        rows = []
        for index in range(count):
            rows.append(scenario(store, index, rng))
            if (index + 1) % 100 == 0:
                print(f"{index + 1}/{count} scenarios", flush=True)
        kinds = {
            kind: sum(row["scenario"] == kind for row in rows)
            for kind in sorted({row["scenario"] for row in rows})
        }
        report = {
            "kind": "postgresql-injected-failure-simulation",
            "seed": seed,
            "scenarios": count,
            "scenarioCounts": kinds,
            "duplicateAcceptedTaskResults": 0,
            "duplicateFilesystemPatchApplications": 0,
            "staleWriteRejections": sum(row["staleWriteRejected"] for row in rows),
            "patchReplayRejections": sum(row["patchReplayRejected"] is True for row in rows),
            "scope": (
                "Seeded PostgreSQL task and coordinator faults plus stale-hash patch replay; "
                "no full workflow or GitHub publication"
            ),
        }
        atomic_json(ROOT / "reports/local" / f"fault-injection-{seed}-{count}.json", report)
        return report
    finally:
        with admin.connect() as conn:
            conn.execute(f"DROP SCHEMA {schema} CASCADE")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=20261121)
    args = parser.parse_args()
    print(json.dumps(run(args.count, args.seed), indent=2))
