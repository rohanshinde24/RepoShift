import multiprocessing
import os
import threading
import time
import uuid

from .analysis import compiler, plan, targeted_context
from .core import (
    ROOT,
    apply_patch,
    atomic_json,
    check,
    git,
    prepare_source,
    recipe,
    resolve_image,
    snapshot,
    tree,
)
from .provider import propose
from .store import Store


def _heartbeat(stop: threading.Event, interval: float, action, errors: list):
    while not stop.wait(interval):
        try:
            action()
        except Exception as exc:
            errors.append(exc)
            stop.set()
            return


def task_worker(run_id: str, stop):
    store = Store()
    owner = f"{os.getpid()}:{uuid.uuid4()}"
    while not stop.is_set():
        run = store.get(run_id)
        if not run or run["state"] in {"COMPLETE", "FAILED", "CANCELLED"} or run["cancel_requested"]:
            return
        task = store.claim_task(run_id, owner)
        if not task:
            time.sleep(0.1)
            continue
        heartbeat_stop = threading.Event()
        errors = []
        heartbeat = threading.Thread(
            target=_heartbeat,
            args=(heartbeat_stop, 3.0, lambda current=task: store.heartbeat_task(current), errors),
            daemon=True,
        )
        heartbeat.start()
        try:
            patch = propose(store, run, task)
            if errors or heartbeat_stop.is_set() or stop.is_set():
                raise RuntimeError("Task lease lost or cancelled")
            store.finish_task(task, patch)
        except Exception as exc:
            try:
                store.finish_task(task, error=str(exc)[:2000])
            except Exception:
                pass
        finally:
            heartbeat_stop.set()
            heartbeat.join(timeout=1)


class WorkerPool:
    def __init__(self, run_id: str, count: int):
        self.context = multiprocessing.get_context("spawn")
        self.stop_event = self.context.Event()
        self.run_id = run_id
        self.workers = []
        self.restarts = 0
        for _ in range(count):
            self._launch()

    def _launch(self):
        process = self.context.Process(target=task_worker, args=(self.run_id, self.stop_event))
        process.start()
        self.workers.append(process)

    def check(self):
        for process in list(self.workers):
            if not process.is_alive():
                process.join(timeout=0)
                self.workers.remove(process)
                if self.restarts < 6:
                    self.restarts += 1
                    self._launch()
        if not self.workers:
            raise RuntimeError("Worker pool exhausted")

    def close(self):
        self.stop_event.set()
        for process in self.workers:
            process.join(timeout=3)
            if process.is_alive():
                process.terminate()
                process.join(timeout=2)
            if process.is_alive():
                process.kill()
                process.join(timeout=1)
        self.workers.clear()


def execute(store: Store, run: dict):
    base_dir = ROOT / ".runs" / str(run["id"]) / f"attempt-{run['fence']}"
    checkout = base_dir / "checkout"
    checkout.mkdir(parents=True, exist_ok=True)
    started = run["created_at"].timestamp()
    stopped = threading.Event()
    heartbeat_errors = []
    pool = None

    def beat():
        if store.heartbeat(run):
            raise RuntimeError("Cancelled")

    heartbeat = threading.Thread(target=_heartbeat, args=(stopped, 1.0, beat, heartbeat_errors), daemon=True)
    heartbeat.start()

    def guard():
        if heartbeat_errors:
            raise heartbeat_errors[0]
        if time.time() - started > 900:
            raise TimeoutError("Run deadline exceeded")
        if store.get(run["id"])["cancel_requested"]:
            raise RuntimeError("Cancelled")

    def transition(state, detail=None):
        guard()
        store.save(run, state, detail)

    def queued_patch(task_id, files, allowed, context=None, diagnostics=None):
        store.enqueue(
            run,
            task_id,
            {
                "recipe": manifest["id"],
                "files": files,
                "allowed": allowed,
                "context": context,
                "diagnostics": diagnostics,
            },
        )
        while True:
            guard()
            pool.check()
            pending = store.task(run["id"], task_id)
            if pending["run_fence"] != run["fence"]:
                raise RuntimeError("Task belongs to stale coordinator")
            if pending["state"] == "FAILED":
                raise RuntimeError(pending["error"] or "Task failed")
            if pending["state"] == "SUCCEEDED" and pending["result"] is not None:
                return pending["result"]
            time.sleep(0.1)

    try:
        if run["input"]["provider"] == "azure" and os.getenv("REPOSHIFT_ALLOW_PAID") != "1":
            raise RuntimeError("Paid model calls are disabled")
        guard()
        manifest = recipe(run["input"]["recipe"])
        image = run["checkpoint"].get("image") or resolve_image()
        run["checkpoint"]["image"] = image
        prepare_source(run["input"], manifest, checkout)
        before = tree(checkout)
        if compiler("assert", files=before, recipe=manifest):
            raise ValueError("Requested migration is already complete")
        if not (checkout / ".git").exists():
            git(checkout, "init", "-b", "main")
        else:
            git(checkout, "checkout", "-B", "main")
        git(checkout, "config", "user.name", "RepoShift")
        git(checkout, "config", "user.email", "reposhift@localhost")
        git(checkout, "add", ".")
        git(checkout, "commit", "--allow-empty", "-m", "Run source snapshot")
        base_sha = git(checkout, "rev-parse", "HEAD")
        store.artifact(
            run,
            "base",
            {
                "snapshot": snapshot(before),
                "sha": base_sha,
                "recipe": manifest["id"],
                "version": manifest["version"],
                "provider": run["input"]["provider"],
                "repository": run["input"].get("repository"),
                "sourceCommit": run["input"].get("baseRef"),
            },
        )
        transition("ANALYZE")
        if not run["checkpoint"]["patches"]:
            for phase in ("build", "visible"):
                result = check(checkout, manifest["id"], phase, image)
                store.artifact(run, f"baseline-{phase}", result)
                if result["code"]:
                    raise RuntimeError("Baseline repository checks failed")
        graph = compiler("analyze", root=str(checkout))
        store.artifact(run, "graph", graph)
        for saved in run["checkpoint"]["patches"]:
            patch = {**saved["patch"], "base_hash": snapshot(tree(checkout))}
            apply_patch(checkout, patch, manifest["allowedFiles"])
        git(checkout, "add", ".")
        git(checkout, "commit", "--allow-empty", "-m", "Restore accepted checkpoint")
        transition("PLAN")
        tasks = (
            [{"id": "flat", "files": manifest["allowedFiles"], "dependsOn": []}]
            if run["input"].get("configuration") == "A"
            else plan(graph, manifest)
        )
        store.artifact(run, "plan", tasks)
        transition("EXECUTE")
        completed = {
            item["task"] for item in run["checkpoint"]["patches"] if not item["task"].startswith("repair-")
        }
        pool = WorkerPool(str(run["id"]), 1 if run["input"].get("configuration") == "A" else 2)
        while any(task["id"] not in completed for task in tasks):
            guard()
            ready = [
                task
                for task in tasks
                if task["id"] not in completed and all(dep in completed for dep in task["dependsOn"])
            ][:2]
            if not ready:
                raise RuntimeError("DAG cannot make progress")
            commit = git(checkout, "rev-parse", "HEAD")
            for task in ready:
                git(checkout, "worktree", "add", "--detach", str(base_dir / task["id"]), commit)
            # Workers can propose concurrently. Integration stays serial and fenced.
            outputs = []
            for task in ready:
                work = base_dir / task["id"]
                files = tree(work)
                context = (
                    files
                    if run["input"].get("configuration") == "A"
                    else targeted_context(graph, files, task["files"])
                )
                store.enqueue(
                    run,
                    task["id"],
                    {
                        "recipe": manifest["id"],
                        "files": files,
                        "allowed": task["files"],
                        "context": context,
                    },
                )
                outputs.append((task, work, files))
            for task, work, files in outputs:
                patch = queued_patch(task["id"], files, task["files"])
                apply_patch(work, patch, task["files"])
                current = tree(checkout)
                if any(current.get(edit["path"]) != files.get(edit["path"]) for edit in patch["edits"]):
                    raise RuntimeError("Integration conflict")
                run["checkpoint"]["patches"].append({"task": task["id"], "patch": patch})
                store.save(run, "EXECUTE", {"task": task["id"]})
                apply_patch(checkout, {**patch, "base_hash": snapshot(current)}, task["files"])
                git(checkout, "add", ".")
                git(checkout, "commit", "--allow-empty", "-m", task["id"])
                completed.add(task["id"])
        while True:
            transition("BUILD")
            build = check(checkout, manifest["id"], "build", image)
            store.artifact(run, f"build-{run['checkpoint']['repairs']}", build)
            visible = {"code": 1, "output": ""}
            if build["code"] == 0:
                transition("TEST")
                visible = check(checkout, manifest["id"], "visible", image)
                store.artifact(run, f"visible-{run['checkpoint']['repairs']}", visible)
            if build["code"] == 0 and visible["code"] == 0:
                break
            if run["checkpoint"]["repairs"] >= (3 if run["input"].get("configuration", "C") == "C" else 0):
                raise RuntimeError("Repair budget exhausted")
            run["checkpoint"]["repairs"] += 1
            transition("REPAIR")
            repair_id = f"repair-{run['checkpoint']['repairs']}"
            files = tree(checkout)
            patch = queued_patch(
                repair_id,
                files,
                manifest["allowedFiles"],
                diagnostics=(build["output"] + visible["output"])[-16000:],
            )
            repair_dir = base_dir / repair_id
            git(checkout, "worktree", "add", "--detach", str(repair_dir), "HEAD")
            apply_patch(repair_dir, patch, manifest["allowedFiles"])
            run["checkpoint"]["patches"].append({"task": repair_id, "patch": patch})
            store.save(run, "REPAIR")
            apply_patch(checkout, patch, manifest["allowedFiles"])
            git(checkout, "add", ".")
            git(checkout, "commit", "--allow-empty", "-m", "Repair")
            store.artifact(run, "graph", compiler("analyze", root=str(checkout)))
        pool.close()
        pool = None
        transition("VERIFY")
        after = tree(checkout)
        forbidden = sorted(
            name
            for name in set(before) | set(after)
            if before.get(name) != after.get(name) and name not in manifest["allowedFiles"]
        )
        migration = compiler("assert", files=after, recipe=manifest)
        hidden = (
            check(checkout, manifest["id"], "hidden", image)["code"] == 0
            if not forbidden and migration
            else False
        )
        verification = {
            "passed": not forbidden and migration and hidden,
            "forbidden": forbidden,
            "migration": migration,
            "hidden": hidden,
        }
        run["checkpoint"]["verification"] = verification
        store.artifact(run, "verification", verification)
        if not verification["passed"]:
            raise RuntimeError("Independent verification failed")
        run["checkpoint"]["commit"] = git(checkout, "rev-parse", "HEAD")
        store.artifact(run, "patch", git(checkout, "diff", base_sha, "HEAD"))
        if run["input"].get("publish"):
            from .github import publish

            transition("PUBLISH")
            store.one(
                "INSERT INTO publish_outbox(run_id,branch) VALUES(%s,%s) "
                "ON CONFLICT DO NOTHING RETURNING run_id",
                (run["id"], f"reposhift/{run['id']}"),
            )
            url = publish(str(run["id"]), manifest["id"], before, after)
            store.artifact(run, "pull_request", url)
            store.one(
                "UPDATE publish_outbox SET pr_url=%s WHERE run_id=%s RETURNING run_id", (url, run["id"])
            )
        transition("COMPLETE")
    except Exception as exc:
        run["error"] = str(exc)[:2000]
        latest = store.get(run["id"])
        if latest and latest["fence"] == run["fence"]:
            try:
                store.save(run, "CANCELLED" if latest["cancel_requested"] else "FAILED")
            except Exception:
                pass
    finally:
        stopped.set()
        if pool:
            pool.close()
        heartbeat.join(timeout=2)
        try:
            git(checkout, "worktree", "prune")
        except Exception:
            pass
    latest = store.get(run["id"])
    atomic_json(
        ROOT / ".runs" / str(run["id"]) / "report.json",
        {"run": latest, "artifacts": store.artifacts(run["id"]), "events": store.events(run["id"])},
    )
    return latest


def work_once(store: Store):
    run = store.claim(str(uuid.uuid4()))
    return execute(store, run) if run else None
