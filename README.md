# RepoShift

A TypeScript code-migration prototype with graph planning, isolated worktrees, durable execution, compiler-guided repair, and independent verification.

**Current status:** a runnable local development slice. Two development migrations work end to end with reference patches; two different task lineages are frozen as a small held-out set. Azure-shaped calls, repair, and usage accounting run in independent processes against a local HTTPS double. A local Ollama adapter can generate patches with no cloud spend. Real Azure inference, real PR publication, and cloud deployment have not been validated. Reference mode and protocol doubles are not model-performance benchmarks.

## Quick start

Requires Node.js 22+, npm, Git, and a running Docker daemon.

```sh
npm ci
docker compose up -d --wait
docker build -t reposhift-runner:dev -f runner/Dockerfile .
npm run build
npm test
npm run fixtures:verify
npm run test:integration
npm run demo:local
```

The demo launches independent local reference-task worker processes and makes zero model calls. It writes `reports/local/local-demo.json`. `npm run test:workers` injects worker failure and writes `reports/local/worker-reliability.json`.

Reports, diffs, graph/DAG data, visible diagnostics, usage, and state transitions are stored in PostgreSQL and `.runs/<run-id>/report.json`. Fixture validation writes `reports/local/fixtures.json`. Local PostgreSQL listens only on `127.0.0.1:55432`. Its development credentials are not suitable for a cloud installation. `docker compose down` stops the database without deleting its volume.

## Local model pilot

With [Ollama](https://ollama.com/) running locally and `qwen2.5:7b` already installed, run:

```sh
REPOSHIFT_ALLOW_PAID=0 npm run pilot:local-model
```

This runs one generated-patch attempt for each of the two frozen tasks in configuration C and writes every outcome to `reports/local/ollama-pilot-<batch>.json`. Individual run reports live in `.runs/<run-id>/report.json`. It uses the loopback-only Ollama API and records the installed model digest and token counts. An initial pilot failed on both tasks because Qwen edited outside each task's allowed file set; the path schema was then tightened using a development task. Subsequent runs on these same frozen tasks are exploratory, not an untouched held-out benchmark. The local adapter requests schema-constrained JSON; patch paths, base hashes, builds, tests, and hidden verification are still checked by RepoShift.

## Azure model runs

Paid model calls are disabled by default. Set `REPOSHIFT_ALLOW_PAID=1` only when deliberately enabling a budgeted live run; this switch is an opt-in, not a dollar spending cap.

Copy `.env.example` to `.env`, populate your own Azure endpoint/deployment/key, and load it in your shell before starting processes (`set -a; . ./.env; set +a`). Never commit secrets.

```sh
npm run cli -- submit sdk-options azure
npm run cli -- worker --once
npm run cli -- status <run-id>
npm run cli -- cancel <run-id>
```

The Azure adapter calls `/openai/v1/chat/completions` with one strict `propose_patch` tool and parallel tool calls disabled. Startup authentication/schema support is currently verified by the first real request, not a separate paid probe. Invalid/refused/truncated tool responses fail closed. Workers reserve each request's token budget transactionally in PostgreSQL before calling the model. Successful responses record usage; ambiguous failures retain their reservations conservatively, including after worker death. This is a token ceiling, not a dollar ceiling. Cost remains unknown until a dated price table is configured.

## API

Set `REPOSHIFT_API_TOKEN` to at least 24 characters. Run `npm start` and, in a separate terminal, `npm run cli -- worker`. The API binds to localhost:3000. All endpoints require `Authorization: Bearer <token>`.

```http
POST /runs
Idempotency-Key: a-unique-request-key
Content-Type: application/json

{"recipe":"sdk-options","provider":"azure","configuration":"C"}
```

`GET /runs/:id` returns state and artifacts. `POST /runs/:id/cancel` requests cancellation. Repeated identical submissions return the same run; reusing a key for different inputs fails.

For public GitHub source input, configure `REPOSHIFT_ALLOWED_REPOSITORIES=owner/repo` and add `repository: "owner/repo"` and `baseRef: "<full 40-character commit SHA>"` to the request. Only reviewed repositories matching a supplied recipe's file layout and trusted checks are supported. Private-repository acquisition and arbitrary migration goals are not implemented.

Publication is off by default. Set `GITHUB_TOKEN`, `REPOSHIFT_GITHUB_REPOSITORY`, and `publish: true` only for an authorized demo repository containing the exact source snapshot. The publisher checks source contents, creates a deterministic branch and draft PR, and reconciles an ambiguous response. It never merges. Existing remote content that differs from the verified source is rejected.

## What is implemented

- Compiler API import/symbol-reference analysis, reverse dependency expansion, strongly connected component grouping, and DAG scheduling.
- At most two concurrent patch proposals in separate Git worktrees; serialized integration with stale-patch checks. Targeted context includes affected files, relevant callers/dependencies, and target SDK declarations.
- PostgreSQL run claims with `SKIP LOCKED`, expiring leases, fencing tokens, durable patch checkpoints, cancellation, and JSON artifacts. DAG tasks are claimed by independent local processes in reference, Ollama, and Azure modes. A coordinator schedules dependencies and integrates accepted outputs. Separate processes share task and model-request budgets through PostgreSQL. Multi-machine execution is not validated.
- Explicit analysis/planning/execution/build/test/repair/verification/publication states. Three visible-diagnostic repair rounds, 30 model requests, conservative 100,000-token budget, and a 15-minute run deadline.
- Non-root Docker checks with no egress, dropped capabilities, read-only mounts/root, no host secrets/socket, and resource/time limits. Rootless Docker on Linux remains the deployment target; local tests use Docker Desktop.
- A separately mounted hidden suite, migration assertions, and a final forbidden-file check. Hidden diagnostics never enter the model's repair context.
- Authenticated API, CLI, local Ollama and Azure adapters, guarded GitHub publisher, and an A/B/C development evaluation runner.

The Azure model receives one typed patch tool; Ollama receives the equivalent JSON schema. Additional interactive read/reference/check tools, a browser run page, a monetary cap, and cross-host deployment remain follow-up work. The static migration checks deliberately recognize the supplied recipe patterns; they are not a general proof of arbitrary TypeScript migration correctness.

## Evaluation and evidence

The zero-cost [local A-versus-C baseline smoke test](BASELINE.md) compares one development task and records both attempts. [Local validation evidence](VALIDATION.md) records the fixture and integration checks. These are engineering checks, not the résumé's claimed success-rate or latency result.

```sh
# Makes paid model calls: 2 development tasks × 3 configurations × 3 trials.
npm run benchmark -- --development
# Optional harness smoke run, explicitly labeled reference-only:
npm run benchmark -- --development --reference
```

A is a flat-context single patch with no repair. B uses the graph/DAG and two workers without repair. C adds bounded repair. Reports include every attempt, success/repair denominators, latency, and tokens; unavailable cost is `null`. `--held-out` selects the two frozen tasks in [benchmarks/v1/manifest.json](benchmarks/v1/manifest.json). This set is too small for a broad success claim. A 20-task held-out set, confidence intervals, 100 fault-injection scenarios, and actual model comparisons remain future release goals in [SPEC.md](SPEC.md).

Verifier validation checks five variants per migration: original, reference, incomplete, a behavior bug invisible to visible tests, and a forbidden-file edit. Only the reference must pass all criteria. Integration tests use real PostgreSQL and Docker; Azure repair and GitHub response-loss tests use protocol doubles. Run-level checkpoint tests simulate coordinator lease expiry. Task-level tests actually SIGKILL a child worker after claim, wait for its lease to expire, and verify that a second process completes the task exactly once in the database. This is local process recovery, not evidence of host/network-partition tolerance.

No 62%→84%, 41% latency improvement, 1,000-failure reliability, or other model-performance result has been established.

## Zero-cloud-spend development plan

Continue with local PostgreSQL, Docker, reference/service doubles, and the local model pilot. Retain the source, run reports, and a recorded demo. Azure inference, the 180-run held-out benchmark, and cloud hosting are deferred. No Azure VMs or paid model calls are needed for these local checks.

The hidden checks cover discount boundaries, negative input rejection, Unicode and spaced filenames, concurrent reads, missing files, malformed JSON, and preservation of false/default values. The two extra fixtures are separate frozen task lineages; their source and checks are protected by recorded hashes. Their first model run exposed an adapter path-schema limitation that was fixed, so future unbiased model metrics require new frozen task lineages.

## Optional future deployment gate

Only when a budget is available, provide an Azure subscription/region, model endpoint/deployment, authorized GitHub demo repository, and spending ceiling. Then validate real model migrations and PR publication before provisioning the two-VM setup in the spec. Do not expose this development API or execute unreviewed public submissions as a service.
