# RepoShift

RepoShift migrates supported TypeScript repositories with a Python coordinator, bounded worker processes, compiler-based dependency planning, Docker checks, and optional model-generated patches. Start with the reference provider to verify the whole workflow without an LLM account or API charges.

The supported recipes are `sdk-options`, `fs-promises`, `sdk-wrapper`, and `fs-settings`. The verifier recognizes these migration patterns. It does not validate arbitrary migration goals.

## Prerequisites

- Python 3.12 or newer. Local development and CI use Python 3.13.
- Node.js 22 or newer and npm. Python calls a small TypeScript compiler helper for source analysis.
- Git and Docker with a running daemon. The checks execute in a local Docker image.
- Enough free disk space for the PostgreSQL and runner images. Ollama is optional.

These instructions use a macOS or Linux shell. The local reference run does not need Azure credentials, a GitHub token, or Ollama.

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

`npm run build` creates the TypeScript parser helper used by the Python service. Docker Compose starts a development PostgreSQL instance on `127.0.0.1:55432`; its credentials in `compose.yaml` are for local use only. The runner image is used for build, visible-test, and hidden-test checks.

## Verify the installation

Run these from the repository root with the virtual environment active:

```sh
ruff check reposhift python_tests
ruff format --check reposhift python_tests
pytest -q python_tests
python -m reposhift.cli demo sdk-options reference
```

The demo should finish with `"state": "COMPLETE"`, `"verification": {"passed": true, ...}`, and zero model requests. Its complete report is saved at `.runs/<run-id>/report.json`. The Python tests include real PostgreSQL and Docker workflow checks, so they require both services started above. The existing TypeScript regression checks can also be run with `npm test`, `npm run test:integration`, and `npm run fixtures:verify`.

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

The API listens on `127.0.0.1:3000`. Submit a local fixture migration from a third terminal with the same environment loaded:

```sh
curl -sS -X POST http://127.0.0.1:3000/runs \
  -H "Authorization: Bearer $REPOSHIFT_API_TOKEN" \
  -H "Idempotency-Key: local-example-1" \
  -H "Content-Type: application/json" \
  -d '{"recipe":"sdk-options","provider":"reference","configuration":"C"}'
```

The response contains a run ID. Use `GET /runs/<id>` to read its state, artifacts, and events, or `POST /runs/<id>/cancel` to request cancellation. Include the same authorization header on every request. Reusing an idempotency key with the same body returns the same run; use a new key for a new run. The CLI also supports `submit`, `status`, `cancel`, and `demo`; run `python -m reposhift.cli --help` for arguments.

## Choose a patch provider

`reference` uses checked-in reference patches and is the best first run. It makes no model calls. `ollama` uses the local Ollama API at `127.0.0.1:11434` and defaults to `qwen2.5:7b`. After installing Ollama and that model separately, run `python -m reposhift.cli demo sdk-options ollama`. Local generation can fail; RepoShift records the error and stops after its repair budget.

`azure` requires `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY`. Paid calls are blocked unless `REPOSHIFT_ALLOW_PAID=1` is set. The request and token ceilings are safeguards, not a dollar cap. Real Azure inference has not been validated in this project.

For a public GitHub source, set `REPOSHIFT_ALLOWED_REPOSITORIES=owner/repo` and submit `repository: "owner/repo"` with `baseRef` set to a full 40-character commit SHA. The files must match a supported recipe. To request a draft PR, also set `GITHUB_TOKEN`, `REPOSHIFT_GITHUB_REPOSITORY`, and `publish: true`. Publication verifies that the target repository's base files match the source snapshot and never merges the PR. The Python publisher has a response-loss protocol test, but a real PR has not been created with it yet.

## Run the evaluation harness

This command runs one development task under configurations A and C using reference patches. It checks report generation, not model performance:

```sh
python -m reposhift.cli benchmark --split development --provider reference --quick
```

Reports are written to `reports/local/python-benchmark-<batch>.json`. A uses one flat patch without repair. B uses graph planning and bounded workers. C adds up to three visible-test repair rounds. A model comparison requires `--provider ollama` or a deliberately enabled Azure run. The current fixture set is too small to support a broad success-rate claim.

## How the system works

```text
reviewed source and recipe
  -> baseline Docker build and visible tests
  -> TypeScript compiler graph and task DAG
  -> PostgreSQL-leased Python workers with targeted context
  -> typed patch and isolated Git worktree validation
  -> Docker build and visible-test repair loop
  -> migration, forbidden-file, and hidden-test verification
  -> optional draft GitHub PR
```

Python owns the FastAPI service, coordinator, workers, PostgreSQL state, model adapters, patch validation, Docker runner, evaluation harness, and GitHub publisher in `reposhift/`. `src/python-helper.ts` exposes compiler analysis and migration assertions. The earlier TypeScript workflow remains in `src/` for regression comparison. PostgreSQL stores fenced leases, task attempts, model reservations, checkpoints, events, and artifacts. Model calls have a 30-request and 100,000-token ceiling, and runs have a 15-minute deadline. Hidden-test output is not supplied to the repair model.

## Troubleshooting and cleanup

- If Docker checks cannot start, run `docker info`, start the Docker daemon, then rebuild the runner image.
- If Python says the compiler helper is missing, rerun `npm ci` and `npm run build`.
- If PostgreSQL connection fails on port 55432, run `docker compose up -d --wait` and check whether another service is using that port.
- If the API returns 401, load the same `.env` in the request terminal and the API terminal.
- If a run fails, inspect `.runs/<run-id>/report.json` for the state, visible diagnostics, and error. Hidden-test output is intentionally omitted.

Stop the local database with `docker compose down`. This keeps its volume; `docker compose down -v` also deletes the local database data.

## Measured local results and limits

Python reference migrations for `sdk-options` and `fs-promises` completed locally and passed build, visible tests, migration assertions, forbidden-file checks, and hidden tests. This validates the control path, not model performance. An October 5, 2026 reference-only smoke run used one development task per configuration: A passed in 15,461 ms and C passed in 12,942 ms, with zero model tokens in both.

Three sequential Python runs on the same `sdk-options` development task used local Ollama `qwen2.5:7b` and configuration C. The prompt and guard changed between runs, so these are debugging outcomes, not independent benchmark trials:

| Local run | Final result | Elapsed | Model requests | Recorded tokens | Repairs |
| --- | --- | ---: | ---: | ---: | ---: |
| Initial Python prompt | Failed, repair budget exhausted | 244,715 ms | 6 | 5,081 | 3 |
| Public API instruction added | Failed, repair budget exhausted | 186,709 ms | 6 | 6,531 | 3 |
| Recipe-specific no-op guard added | Passed hidden verification | 53,551 ms | 2 | 1,246 | 0 |

The guard avoided a model call for an unchanged caller file. [The earlier TypeScript baseline smoke test](BASELINE.md) and [local validation evidence](VALIDATION.md) record separate checks. Generated run reports are ignored by Git.

The résumé figures of 62% to 84% success, 41% lower median time, and zero duplicate mutations across 1,000 injected failures have **not** been reproduced. Real Azure inference, a real Python-generated GitHub PR, cross-host execution, and cloud deployment also remain unverified.
