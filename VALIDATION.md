# Local validation evidence

Validated September 26, 2026. This records engineering checks, not measured model performance.

| Check | Result |
| --- | --- |
| TypeScript build and formatting | Passed |
| Unit tests | 9 passed, including local Ollama request/usage validation |
| PostgreSQL, Docker, process, and local HTTPS integration | 20/20 passed before the Ollama adapter was added; not rerun this turn |
| Frozen fixture verifier | 20/20 expected outcomes across four fixtures |
| Held-out reference workflow | `sdk-wrapper` and `fs-settings` reached `COMPLETE`; build, visible, hidden, migration, and forbidden-file checks passed; zero model requests |
| Local generated-patch development run | `sdk-options` reached `COMPLETE` with Qwen 2.5 7B; three requests, 1,907 tokens, no repair; hidden verification passed |
| First local-model frozen-task pilot | 0/2 completed; both rejected for attempted edits outside task-owned files |
| Post-fix exploratory pilot | 1/2 completed: `sdk-wrapper` passed after two repairs; `fs-settings` timed out before verification |

The fixture set has two development tasks (`sdk-options`, `fs-promises`) and two frozen, different-lineage held-out tasks (`sdk-wrapper`, `fs-settings`). [The manifest](benchmarks/v1/manifest.json) records file hashes and runner/check hashes. Each task is checked against five variants: original, reference, incomplete, a behavioral bug that visible tests miss, and a forbidden-file edit. Only the reference variant passes all criteria. Twenty verifier outcomes are not twenty independent migration tasks.

The held-out reference run reports are in `.runs/71fee342-1d65-41ef-930e-6ae9de45623e/report.json` and `.runs/cd952a33-ef18-4c97-941f-e2a177440e4a/report.json`. Each has a three-task dependency plan, independent worker claims, and a final verification artifact. These runs establish that the local orchestration and checks can complete; the patches were supplied by the reference provider.

The first Qwen frozen-task pilot is recorded in `reports/local/ollama-pilot-af34870e-941d-43e1-a04d-e2f39539814c.json`. It made one model request per task (635 and 615 tokens) and rejected both proposed patches as forbidden. A development run then exposed a proposal for `src/wholesale.ts` while the worker owned only `src/retail.ts`. The local JSON schema was tightened to enumerate each task's allowed paths and exact base hash. A new development run, `.runs/8a6c99de-ae2f-42b0-8958-caae51339a9b/report.json`, completed all three tasks and independent verification. Any rerun of the same frozen tasks after this diagnosis is exploratory; a fresh held-out set is needed for unbiased model metrics.

The exploratory rerun is `reports/local/ollama-pilot-272f71a1-ab28-4e58-9fa6-fcff3ccedef4.json`. `sdk-wrapper` reached `COMPLETE` after five model requests, 4,471 recorded tokens, and two compiler/test-guided repair rounds; its final hidden and migration checks passed. `fs-settings` failed when its second local request hit the 180-second timeout; only one patch had been accepted, so no final build/hidden result exists. The local model digest is in the report. This is evidence that generated patches and repair can work on one task, not an autonomous success-rate claim.

Failure tests cover lease expiry and worker replacement, stale-result fencing, two-worker concurrency, duplicate enqueueing, cancellation, and bounded retries. Azure-mode workers were exercised against a local HTTPS protocol double: strict patch-tool responses, repair, HTTP 429 retry, shared PostgreSQL request/token reservations, a worker killed after reservation, cancellation before and during requests, and a concurrent budget ceiling. This verifies control flow and accounting locally. It does not demonstrate real Azure inference, multi-host recovery, or a measured success rate.

To reproduce with Node 22+, Docker, the runner image, and local PostgreSQL:

```sh
npm run build
npm test
npm run test:integration
npm run format:check
npm run fixtures:verify
npm run demo:local
npm run cli -- demo sdk-wrapper
npm run cli -- demo fs-settings
REPOSHIFT_ALLOW_PAID=0 npm run pilot:local-model # requires local Ollama and qwen2.5:7b
```

The generated reports in `reports/local/` and `.runs/` are ignored by Git and contain environment-specific identifiers. The benchmark manifest and fixture inputs are versioned in source.

No cloud resources were provisioned and no paid model calls were made. `REPOSHIFT_ALLOW_PAID` defaults to disabled; enabling it is only an opt-in gate, not a monetary cap. Real Azure performance, a real GitHub PR, a larger held-out benchmark, and cloud deployment remain unverified. Numeric résumé claims should wait for recorded model runs with exact task and trial counts.

An October 5, 2026 [local baseline smoke test](BASELINE.md) compared A and C once on the `sdk-options` development task: A failed build in 74.7 seconds; C passed hidden verification in 143.1 seconds. This does not establish a success-rate or latency improvement.
