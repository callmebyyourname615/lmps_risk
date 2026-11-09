# P03 Automated Intake — 2026-11-04

Delivered a finite, host-side isolated test-batch runner and `pnpm intake:automated-demo`, using the original file verification, staging, publication, approved detection and monitoring/reconciliation modules. The demo generates only invented data in a new disposable PostgreSQL cluster. It refuses the known persistent project ports and foreign database scope. No live source, daemon/watcher, persistent Intake write or policy activation by the batch runner is included.

| P03 requirement | Progress / remaining target gate |
| --- | --- |
| P03-01 Backbone | Existing proposed ADR retained; no production backbone adoption. |
| P03-02 Capture/connector | Verified local CSV transport reused. Approved continuous replica/CDC capture and compatibility remain pending. |
| P03-03 Approved normalization | Existing six-column source publication and immutable revision boundary reused. Real source mapping/tokenization/authority remain unverified. |
| P03-04 Handoff/checkpoints | Staging prefix resume, committed publication recovery after SIGKILL, exact retry, correction and existing leased detection are verified locally. Source stream positions, cutover and actual history/update/delete semantics remain open. |
| P03-05 Compatibility/failures | Strict manifest/CSV/hash checks reject changed inputs; partial/waiting/retry states stay explicit. Selected registry, durable DLQ/remediation and source schema evolution remain pending. |
| P03-06 Historical writer | No Parquet/object-storage writer is added. |
| P03-07 Query/storage decision | Existing local read models are reused, without adopting a historical platform or claiming representative performance. |
| P03-08 Reconciliation | Exact staging/source/published-row comparisons and decimal recorded-amount totals by currency; current-vs-historical Alert counts remain separate. Actual source completeness/product/date/settlement reconciliation remains gated. |
| P03-09 Modes/isolation | Disposable fixture database, dedicated namespace, local/test guards, persistent-port and mixed-scope refusal. Production shadow/backfill permissions and rollout remain pending. |

Final local checks: 47 focused tools/source/publication/audit/identity tests passed with zero failures/skips; workspace typecheck and worker build passed. The actual demo passed and retained `.local/automated-intake/v1/5d43cb1d-ce09-4016-bd57-9e338218b4b3/acceptance.json` after successful teardown. Tests force a real child SIGKILL after publication, concurrent-owner refusal, risk storage failure/retry, unseen stale input, foreign scope and missing-target frozen observations. Existing historical risk/Alert evidence remains unchanged.

The [runbook](../operations/automated-intake.md) defines callback/checkpoint authority, limits, partial/complete semantics, failure retention and execution. This is local engineering acceptance, not closure of all P03 requirements or production readiness. No new dependency or migration was introduced. Full-workspace tests, fresh-source verification, browser acceptance and real-source capacity/ordering/cutover were not rerun by this batch.
