# RepoShift

RepoShift migrates supported TypeScript repositories with a Python coordinator, bounded worker processes, compiler-based dependency planning, Docker checks, and optional model-generated patches. Start with the reference provider to verify the whole workflow without an LLM account or API charges.

The original recipes are `sdk-options`, `fs-promises`, `sdk-wrapper`, and `fs-settings`. The versioned v2 benchmark has 20 synthetic instances across four migration archetypes. The v3 suite has six synthetic archetypes. The v4 suite has 12 distinct program behaviors, with four development and eight held-out tasks. The verifier recognizes these migration patterns. It does not validate arbitrary migration goals.

## Prerequisites

- Python 3.12 or newer. CI uses Python 3.13.
- Node.js 22 or newer and npm. Python calls a small TypeScript compiler helper for source analysis.
- Git and Docker with a running daemon. The checks execute in a local Docker image.
- Enough free disk space for the PostgreSQL and runner images. Ollama is optional.

These instructions use a macOS or Linux shell. The reference run does not need Azure credentials, a GitHub token, or Ollama.

## Install from a fresh clone

```sh
git clone https://github.com/rohanshinde24/RepoShift.git
cd RepoShift
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
npm ci
npm run build
docker compose up -d --wait
docker build -t reposhift-runner:dev -f runner/Dockerfile .
```

`npm run build` creates the TypeScript parser helper used by the Python service. Docker Compose starts a development PostgreSQL instance on `127.0.0.1:55432`; its credentials in `compose.yaml` are for local use only. The runner image is used for build, visible-test, regression-probe, and hidden-test checks.

## Verify the installation

Run these from the repository root with the virtual environment active:

```sh
ruff check reposhift python_tests scripts
ruff format --check reposhift python_tests scripts
pytest -q python_tests
npm run lint
npm run test
npm run format:check
python -m reposhift.cli demo sdk-options reference
```

The demo should finish with `"state": "COMPLETE"`, `"verification": {"passed": true, ...}`, and zero model requests. Its complete report is saved at `.runs/<run-id>/report.json`. The Python tests include real PostgreSQL and Docker workflow checks, so they require both services started above.

## Run the API

Copy the example configuration and replace its API token with a random value of at least 24 characters. `.env` is ignored by Git and is **not** loaded automatically.

```sh
cp .env.example .env
python -c 'import secrets; print(secrets.token_urlsafe(32))'
```

Paste the generated value into `REPOSHIFT_API_TOKEN` in `.env`. In each terminal that runs RepoShift or sends API requests, load the file:

```sh
set -a
source .env
set +a
```

Start the API in one terminal and a coordinator in another. Activate the virtual environment and load `.env` in both terminals.

```sh
python -m reposhift.cli serve
```

```sh
python -m reposhift.cli worker
```

The API listens on `127.0.0.1:3000`. Submit a fixture migration from a third terminal with the same environment loaded:

```sh
curl -sS -X POST http://127.0.0.1:3000/runs \
  -H "Authorization: Bearer $REPOSHIFT_API_TOKEN" \
  -H "Idempotency-Key: local-example-1" \
  -H "Content-Type: application/json" \
  -d '{"recipe":"sdk-options","provider":"reference","configuration":"C"}'
```

The response contains a run ID. Use `GET /runs/<id>` to read its state, artifacts, and events, or `POST /runs/<id>/cancel` to request cancellation. Include the same authorization header on every request. Reusing an idempotency key with the same body returns the same run; use a new key for a new run. The CLI also supports `submit`, `status`, `cancel`, and `demo`; run `python -m reposhift.cli --help` for arguments.

## Choose a patch provider

`reference` uses checked-in reference patches and is the best first run. It makes no model calls. `ollama` uses the Ollama API at `127.0.0.1:11434` and defaults to `qwen2.5:7b`. After installing Ollama and that model separately, run `python -m reposhift.cli demo sdk-options ollama`. If generation fails, RepoShift records the error and stops after its repair budget.

`azure` requires `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY`. Paid calls are blocked unless `REPOSHIFT_ALLOW_PAID=1` is set. The request and token ceilings are safeguards, not a dollar cap.

For a public GitHub source, set `REPOSHIFT_ALLOWED_REPOSITORIES=owner/repo` and submit `repository: "owner/repo"` with `baseRef` set to a full 40-character commit SHA. The source must contain the recipe's allowed files. The `reference` provider additionally requires the full source tree to match the recipe's frozen base. To request a draft PR, also set `GITHUB_TOKEN`, `REPOSHIFT_GITHUB_REPOSITORY`, and `publish: true`. Publication verifies that the target repository's base files match the source snapshot and never merges the PR.

## Run the evaluation harness

This command runs one task under configurations A and C using reference patches to check the evaluation harness:

```sh
python -m reposhift.cli benchmark --split development --provider reference --quick
```

Reports are written to `reports/local/python-benchmark-<batch>.json`. A uses one flat patch with up to three visible-test repair rounds. B uses graph planning and bounded workers without repair. C combines graph planning, bounded workers, and the same repair budget as A. Reference patches make no model calls; use `--provider ollama` or a deliberately enabled Azure run to evaluate model-generated patches.

To validate every v4 fixture and run paired A/C trials on its development split:

```sh
PYTHONPATH=. python scripts/verify_v2_tasks.py --suite v4
python -m reposhift.cli benchmark --suite v4 --split development --provider ollama --trials 1 --compare-only
```

The v2 instances are controlled variants of four archetypes, with two archetypes in each split. Treat the archetype as the independent unit when interpreting those results. The v3 suite has six synthetic archetypes. The v4 tasks exercise 12 program behaviors, but each migration family shares a common scaffold. The eight held-out v4 tasks have not been used for model evaluation. These correlated synthetic tasks do not establish a general migration success rate. A release comparison needs independent unseen repositories, a fixed model and prompt, identical trial counts and budgets, and raw reports retained for audit. The harness alternates configuration order by task and trial to reduce model warmup bias. The report records task, probe, and implementation hashes, the runner image digest, pairs A and C by task and trial, and includes failed attempts in the success and all-attempt latency figures. Each attempt also records `stateTimingsMs` and `checkTimingsMs` to separate workflow time from individual Docker checks. On a resumed run, check timings show the latest check for each stage; state timings cover the full run. A reference run validates orchestration only; it does not measure model migration quality.

### Measured v4 development pilot

On November 22, 2026, I ran one paired local Ollama `qwen2.5:7b` trial on each of the four v4 development tasks. A and C both completed 4/4 tasks. Median all-attempt latency was 80,526 ms for A and 120,007.5 ms for C. A recovered one task after a failed initial check; C required no repair. These are development tasks from two shared scaffolds, so this is a diagnostic pilot, not a held-out performance estimate. See the [raw development report](benchmarks/results/v4-development-qwen2.5-7b.json).

### Measured v3 benchmark

On November 22, 2026, I ran one paired local Ollama `qwen2.5:7b` trial on each of the three v3 held-out synthetic archetypes. A and C used the same model settings, task catalog, and probes. The v3 report did not record the runner image digest, so its exact image cannot be independently verified from the report. Success required build, visible tests, migration assertions, regression probes, forbidden-file checks, and hidden tests to pass. Latency includes failed attempts.

| Configuration | Successful tasks | Median all-attempt latency | Recorded model tokens |
| --- | ---: | ---: | ---: |
| A | 1/3 | 79,648 ms | 11,279 |
| C | 2/3 | 49,935 ms | 11,402 |

This is a three-task synthetic benchmark, not a general migration success estimate. The 62% to 84% success and 41% lower median time figures are not reproduced. See the [raw benchmark report](benchmarks/results/v3-heldout-qwen2.5-7b.json) and [pre-evaluation freeze](benchmarks/results/v3-heldout-freeze.json) for attempts, failures, hashes, and model settings.

Each v2 and v3 archetype has a versioned probe in `benchmarks/probes/`; v4 probes are in `benchmarks/v4/probes/`. RepoShift runs the same probe against the original and migrated code in separate Docker containers. A changed result becomes a visible repair diagnostic. Probes cover selected public behavior, not every possible input. Hidden-test output is still withheld from the model.

When a probe finds a behavior change, the compiler helper looks for newly introduced catch handlers that return literal fallbacks or wrap an error in a generic `Error`. If there is one unambiguous handler and the probe failure matches, a typed repair rethrows the caught error and the workflow repeats its checks. Otherwise the model receives a repair task with the original changed files and the failing probe result. A model repair that makes no effective change gets one bounded retry before the run fails. Both repair paths use the same three-round check budget.

To exercise task-result fencing and stale patch rejection under injected failures:

```sh
PYTHONPATH=. python scripts/run_fault_injection.py --count 1000
```

This simulation covers duplicate requests, worker lease expiry, coordinator lease expiry, cancellation, and patch replay. It checks accepted task results and filesystem patch applications. It does not inject failures into complete model runs or GitHub publication.

Measured simulated reliability, seed `20261121`: 1,000 scenarios, 250 per failure type, produced zero duplicate accepted task results and zero duplicate filesystem patch applications. All 1,000 stale task writes were rejected, and all 750 applicable patch replays were rejected. These figures describe the simulation above, not end-to-end migration success.

## How the system works

```text
reviewed source and recipe
  -> baseline Docker build, visible tests, and regression probe
  -> TypeScript compiler graph and task DAG
  -> PostgreSQL-leased Python workers with targeted context
  -> typed patch and isolated Git worktree validation
  -> Docker build, visible-test, migration, and regression repair loop
  -> migration, forbidden-file, and hidden-test verification
  -> optional draft GitHub PR
```

Python owns the FastAPI service, coordinator, workers, PostgreSQL state, model adapters, patch validation, Docker runner, evaluation harness, and GitHub publisher in `reposhift/`. `src/python-helper.ts` exposes compiler analysis and migration assertions. PostgreSQL stores fenced leases, task attempts, model reservations, checkpoints, events, and artifacts. Model calls have a 30-request and 100,000-token ceiling, and runs have a 15-minute deadline. Hidden-test output is not supplied to the repair model.

## Troubleshooting and cleanup

- If Docker checks cannot start, run `docker info`, start the Docker daemon, then rebuild the runner image.
- If Python says the compiler helper is missing, rerun `npm ci` and `npm run build`.
- If PostgreSQL connection fails on port 55432, run `docker compose up -d --wait` and check whether another service is using that port.
- If the API returns 401, load the same `.env` in the request terminal and the API terminal.
- If a run fails, inspect `.runs/<run-id>/report.json` for the state, visible diagnostics, and error. Hidden-test output is intentionally omitted.

Stop the local database with `docker compose down`. This keeps its volume; `docker compose down -v` also deletes the local database data.
