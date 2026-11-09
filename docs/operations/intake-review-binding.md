# Bind rich CSV evidence to existing Intake revisions

This read-only step binds one verified sample CSV bundle to its already-imported transaction revisions. It supports the exporter sample contract (at most 1,000 transfer rows) and requires the sibling Data_Requirement verifier and the owned Intake database. No lifecycle mapping or revision update is performed.

Run from the Core repository:

    ./node_modules/.bin/node --env-file=.local/environments/intake/runtime.env tools/bind-intake-review.mjs --bundle /absolute/path/to/sample

The Python bridge first verifies the complete export manifest, hashes, schema, row counts, exact decimal totals and review/import projection. It rereads the manifest and transfer files against those commitments. It returns only six-column import values and hashes of the decoded 22-column review rows; account values do not cross the bridge.

The Node command loads the existing deterministic import receipt and rechecks the complete staged batch. It uses a repeatable-read, read-only database transaction to find the latest revision for each composite source key. Each stored publication is revalidated and its payload recomputed with the existing shared contract. All six source fields must exactly match; swapped, missing, conflicting, duplicated or stale evidence fails before a receipt is written.

An immutable private receipt is saved under .local/intake-review-bindings/v1. It contains manifest/review/import hashes, batch and staged-row hashes, review row positions and full-row hashes, plus exact transaction revision and payload/publication hashes. It does not copy account fields or apply operator declarations. Exact reruns return duplicate and never overwrite partial or changed evidence.

The receipt records which immutable revision was matched during the read. If a later revision appears, the next mapping step must recheck its binding before making a change. File hashes establish content consistency, not source-owner authority, account identity, completeness of history or authenticity of the export.

Tests:

    ./node_modules/.bin/node --test tools/bind-intake-review.test.mjs
    python3 -m unittest discover -s ../Data_Requirement -p test_verify_csv_export.py -q

## Step 2: joint mapping preview

The contract function jointIntakeLifecycle in intake-source-contract.ts implements operator_intake_test_result_revert_v2 for local/test preview. Exact OK plus shouldrevert string 0 returns succeeded; a nonempty non-OK result without surrounding whitespace plus string 1 returns failed and refund_instruction=required. Other well-formed pairs remain unknown. Numeric flags are not coerced. Refund completion and account identity remain unverified, and occurred_at stays null. This adds a standalone version without changing the six-column v1 publisher.

    ./node_modules/.bin/node tools/preview-intake-joint-mapping.mjs --bundle /absolute/path/to/sample --binding /absolute/private/binding.json

The command re-verifies rich CSV evidence through the private bridge, compares file/row commitments with the step-1 receipt, and writes an immutable private preview under .local/intake-mapping-previews/v2. It has no database connection and creates no revisions. It references the previously bound revision; step 3 must recheck current evidence before applying changes.

The actual 201-row sample preview returned 197 succeeded, 2 failed requiring refund, and 2 unknown. Transitions from v1: 197 succeeded unchanged, 2 unknown to failed, and 2 succeeded to unknown because their shouldrevert is null. This preview is operator-declared test interpretation, not independent source-owner approval or proof of completed refunds.

## Step 3: append changed interpretations

Migration 0022_intake_joint_mapping adds publication v2 without modifying applied migrations or existing evidence. Apply migrations to the explicitly selected owned Intake environment, after a verified private backup, and reload its API before publishing v2. The original environment has a separate migration history and must not be upgraded by this command.

    ./node_modules/.bin/node --env-file=.local/environments/intake/runtime.env tools/apply-intake-joint-mapping.mjs --bundle /absolute/path/to/sample --binding /absolute/private/binding.json

This command requires the Intake profile and port 18513. It re-verifies the rich export, bound receipt, completed staged batch, every original publication/payload hash and current revision. It creates and verifies a private backup before any append. Under the restricted Intake role, one serializable transaction rechecks all rows and appends only status changes; stale or conflicting current evidence cancels the whole transaction. Exact reruns recognize their existing v2 revisions. A commit followed by receipt-publication failure can be retried with the same inputs; existing or partial private receipt files are never overwritten.

Each new publication pins the operator mapping version, original six values, shouldrevert, manifest/review/full-row/binding hashes, and canonical predecessor publication/payload hashes. Review account fields are not copied. Hashes are stable across PostgreSQL jsonb key ordering. The publication reconstructs lifecycle status from result and shouldrevert and never declares refund completion or verified account identity. occurred_at remains null. A refund instruction is not a financial reversal event.

The private application report under .local/intake-mapping-applications/v2 covers all matched rows. For this 201-row sample, four changed interpretations receive v2 revisions; 197 unchanged successes retain their original v1 publications and are explicitly marked retained_v1_revisions. The effective counts are 197 succeeded, 2 failed and 2 unknown. This is not a claim that every publication has migrated to v2. Retaining unchanged revisions avoids re-evaluating their existing evidence and creating new revision-specific Alerts.

The existing detection worker remains responsible for policy-bound revisions. Here only one changed revision is LAK; three are THB without an approved policy. The LAK failed revision evaluates as not_applicable. Historical assessments and Alerts remain bound to their original revisions. Source records/events, policy thresholds and real LMPS data are not updated by the application command.

Timeline keeps its canonical revision hash and may additionally expose legacy_revision_sha256 for an old unnormalized file observation whose complete legacy envelope was revalidated by the Backend. This optional compatibility hash is covered by the timeline content hash. The Portal accepts it only for a matching unavailable file assessment on an unknown-normalization revision, and requires a corresponding bound assessment. Frozen assessment hashes are preserved.

Focused checks:

    pnpm test:intake-tools
    ./node_modules/.bin/node --test packages/contracts/test/source-joint-publication.test.mjs tools/apply-intake-joint-mapping.test.mjs
    ./node_modules/.bin/node --test ../LMPS_Risk_Portal/test/timeline.test.mjs

The standard `pnpm test` verification and `pnpm test:intake` acceptance runner both include the tools regression tests, including bind, preview and atomic application/retry. Native tests use disposable PostgreSQL clusters rather than the persistent Intake database.
