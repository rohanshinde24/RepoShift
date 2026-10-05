# Local baseline smoke test

Run on October 5, 2026. This is one trial on one **development** task, not a held-out performance benchmark or the résumé's baseline tool-agent comparison.

| Configuration | Result | Wall time | Model requests | Recorded tokens |
| --- | --- | ---: | ---: | ---: |
| A: flat single patch, no repair | Failed build | 74.7 s | 1 | 763 |
| C: graph/DAG, two-worker limit, repair available | Passed build, visible tests, hidden tests, and migration assertions | 143.1 s | 3 | 1,907 |

Both attempts used local Ollama `qwen2.5:7b`, the `sdk-options` development fixture, and runner image `sha256:24266ada0a76ca7e769655d1b02f7ccf87d5e2f4669e5a5c6d90178d49e512e4`. No paid API calls were made. A's generated patch imported `wholesale` from `retail.ts`, where it is not exported, and A had no repair step. C passed without using repair on this task.

Evidence: `reports/local/benchmark-44ef3ec6-07bc-4822-a12b-17923c48cde3.json`; A run `.runs/02512259-966c-4944-882c-fa3bbec20eab/report.json`; C run `.runs/776b17cb-7bb7-44e1-820e-98d2543683d1/report.json`. These generated reports are local and ignored by Git.

Reproduce with local Ollama, PostgreSQL, and Docker running:

```sh
REPOSHIFT_ALLOW_PAID=0 npm run benchmark -- --development --ollama --quick
```

This run establishes neither a success-rate improvement nor a latency reduction. A failed, C took longer, and one task gives no meaningful uncertainty estimate. A numerical claim needs new frozen tasks, multiple attempts, a pinned model and images, and all failures retained.
