# Automated Intake — isolated test batches

This P03 batch joins the existing verified CSV bridge, durable offline staging, source/revision publisher, approved-policy detection worker and reconciliation. It supplies a finite batch runner and a runnable disposable acceptance, not a directory watcher, continuous LMPS connector or production authorization. Invented CSV files retain `user_supplied_file` publication provenance; their isolated test origin is recorded separately.

From Core:

```sh
pnpm intake:automated-demo
```

The command builds the existing worker, creates an owned disposable PostgreSQL cluster, applies migrations only there, and prepares an explicitly approved invented LAK policy. It verifies a partially staged batch, runs detection, retries the same batch, then publishes a correction. Successful teardown stops/removes the disposable cluster and retains an aggregate-only private receipt under `.local/automated-intake/v1/<uuid>/acceptance.json`. A failed run stops its cluster and retains scratch evidence for inspection; it does not publish a passing receipt. Errors withhold source values, paths and credentials.

The runner refuses the known persistent project ports 18503/18513. It independently checks cluster ownership and rejects databases containing revision/job/policy-binding scope outside `synthetic_local / synthetic_automated`. The command takes no input source, DSN or target options. It never starts/reloads the existing Intake API or a push worker and never connects to LMPS. Do not use the callable runner as approval to target another existing database.

## Processing and checkpoints

`runAutomatedIntakeBatch(state, {manifestPath, inputPath, generation, observedAt}, onProgress?)` is the reusable host-side test runner in `tools/automated-intake.mjs`. The default progress callback does nothing. Paths must be absolute and refer to private owned manifest/CSV files under private directories. Existing no-follow, size, UTF-8, header, field, file-hash, row-count and row-hash checks are reused. Scope, row bounds, canonical observation time and every publication projection are checked before business writes.

1. **Verified:** detached input and exact file commitments pass; the dedicated test scope and prospective cohort size are checked. Only one cooperating runner may own the advisory lock.
2. **Staged:** `importOfflineDataset` resumes the existing `loaded_rows` checkpoint and reconciles exact rows. It does not truncate/reseed committed staging.
3. **Published:** the existing publisher appends source/revision evidence; exact retries deduplicate. Changed stale observations are rejected before their source event is written. Unchanged evidence keeps its original revision.
4. **Detected:** the existing handoff and leased/fenced worker discover eligible revisions and execute frozen approved policy/jobs/assessments/Alerts. The runner does not create, approve or activate policy. The selected test bootstrap includes a separate missing-target job only to supply the existing approved Alert-policy template; that unavailable historical assessment never covers a cohort transaction.
5. **Reconciled:** staging is rechecked, each current published batch row is recomputed and compared to its source values, and exact recorded-amount totals are grouped by currency. Existing Detection Health and Monitoring readers validate current results. Historical stored Alert count is reported separately from current-revision Monitoring Alerts.

Authoritative checkpoints are the existing staging rows, immutable revisions and durable risk job stage/attempt/lease records. Progress notifications and the final receipt are not a new trusted source cursor or a substitute for database evidence. On restart, the same frozen input is verified again and committed effects deduplicate. No all-file transaction is claimed: a later failure retains committed progress for exact retry. Policy/source ordering and unknown outcomes must not be repaired by rewriting old evidence.

The finite runner accepts at most 500 input rows and 500 source identities in its dedicated cohort, within the original 64 MiB CSV limit. Detection draining uses at most 40 existing handoff/work cycles. It never bypasses a retry deadline or changes a failed job to success. A lease/retry/policy wait or missing bound Assessment leaves the report partial. Limits are not throughput/SLA evidence. The lock coordinates this runner only; dedicated fixture databases must not have other writers. No distributed exactly-once, broker/CDC adoption or multi-writer cutover is established.

## Result interpretation

`complete` means every latest scoped revision has a verified bound Assessment and a completed/assessed processing state. It does not mean the inputs support all detectors, that a policy is approved for production, or that a transaction is safe. `partial` retains waiting-policy, waiting-alert-policy, ambiguous policy, queued/running/retry/failed state and missing assessment counts. A completed job that froze a missing target before arrival cannot make the later revision assessed. The runner never rewrites that observation or silently creates a rescore.

The default four-row fixture has three LAK rows (succeeded, failed and unknown) and one THB row without policy. All three LAK observations get bound assessments; THB remains waiting-policy. The first high-amount revision creates one Alert. After correction below the threshold, current Monitoring has zero flagged rows/Alerts, while the original immutable Alert remains stored. Counts/totals preserve currencies: first LAK recorded amount `1000030.00`, corrected `31.00`; THB `30.00`. These are invented recorded amounts, not executed/refunded settlement totals. There is no FX conversion or inferred refund completion.

Account identity, payment time, historical availability and actual source ordering remain unverified. `observedAt` and the stable generation are caller-declared test inputs, not proof of a source watermark or payment clock. Keep them fixed for an exact retry. An older changed export after a later correction is refused; ordered export capture and operator remediation remain separate from this test orchestrator. Unknown source lifecycle remains unknown, and context-dependent detectors remain unavailable.

## Acceptance

```sh
pnpm --filter @lmps/risk-workers build
node_modules/.bin/node --test tools/automated-intake.test.mjs apps/risk-workers/test/offline-publication-native.test.mjs
```

Native tests resume an actual staging prefix and kill a real child after publication, verify lock release and concurrent-owner refusal, execute existing detection, retry without extra effects, correct observations while retaining frozen assessments/Alerts, and reject unseen stale files before source writes. Forced storage failure produces retry-wait/partial and later recovers the same pinned job after the fixture restores storage; no production retry policy is changed. Foreign test scope, tampered CSV, production mode and persistent ports are refused. A separate scenario proves a pre-arrival missing-target job cannot certify a later revision. Existing tools/worker test entrypoints discover these checks automatically.

Live synchronization, a selected capture/backbone, approved source load/order/checkpoints, real identity/semantics/history, operational policies, auth/secrets, capacity and production rollout remain pending. P03 is not closed by this local acceptance.
