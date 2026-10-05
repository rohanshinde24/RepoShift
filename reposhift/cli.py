import argparse
import json
import signal
import time
import uuid

import uvicorn

from .api import create_app
from .core import recipe
from .store import Store
from .workflow import execute, work_once


def main():
    parser = argparse.ArgumentParser(prog="reposhift")
    actions = parser.add_subparsers(dest="action", required=True)
    submit = actions.add_parser("submit")
    submit.add_argument("recipe")
    submit.add_argument("provider", choices=["reference", "ollama", "azure"], nargs="?", default="reference")
    worker = actions.add_parser("worker")
    worker.add_argument("--once", action="store_true")
    for action in ("status", "cancel"):
        actions.add_parser(action).add_argument("id")
    demo = actions.add_parser("demo")
    demo.add_argument("recipe", nargs="?", default="sdk-options")
    demo.add_argument("provider", choices=["reference", "ollama", "azure"], nargs="?", default="reference")
    actions.add_parser("serve")
    benchmark = actions.add_parser("benchmark")
    benchmark.add_argument("--split", choices=["development", "held-out"], required=True)
    benchmark.add_argument("--provider", choices=["reference", "ollama", "azure"], default="reference")
    benchmark.add_argument("--quick", action="store_true")
    args = parser.parse_args()
    store = Store()
    store.init()
    if args.action == "submit":
        recipe(args.recipe)
        run = store.submit(
            {"recipe": args.recipe, "provider": args.provider, "configuration": "C"}, str(uuid.uuid4())
        )
        print(json.dumps({"id": str(run["id"]), "state": run["state"]}))
    elif args.action == "status":
        print(
            json.dumps(
                {"run": store.get(args.id), "artifacts": store.artifacts(args.id)}, default=str, indent=2
            )
        )
    elif args.action == "cancel":
        store.cancel(args.id)
        print("Cancellation requested")
    elif args.action == "worker":
        running = True

        def stop(*_):
            nonlocal running
            running = False

        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        while running:
            result = work_once(store)
            if args.once:
                print(json.dumps(result, default=str))
                break
            time.sleep(1)
    elif args.action == "demo":
        recipe(args.recipe)
        run = store.submit(
            {"recipe": args.recipe, "provider": args.provider, "configuration": "C"}, str(uuid.uuid4())
        )
        claimed = store.claim(str(uuid.uuid4()), run["id"])
        if claimed:
            execute(store, claimed)
        print(json.dumps(store.get(run["id"]), default=str, indent=2))
    elif args.action == "serve":
        uvicorn.run(create_app(store), host="127.0.0.1", port=3000)
    elif args.action == "benchmark":
        from .benchmark import run_benchmark

        result = run_benchmark(args.split, args.provider, args.quick)
        print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    main()
