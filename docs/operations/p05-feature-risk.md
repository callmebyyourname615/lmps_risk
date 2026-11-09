# P05 local feature → rules → alerts handoff

US-1205 is local synthetic integration only, `production_ready=false`. It preserves the P04 serving/reducer validation, fifteen detectors, separate Fraud/Mule/AML indices, policy lifecycle and existing `projectAlert` semantics. No accuracy, calibrated probability, verified account graph or actual LMPS enforcement is established.

After the trusted runner builds the existing offline dependencies, run from the candidate root with a **new** absolute destination beneath its existing private `.local` directory:

```sh
node apps/risk-workers/scripts/p05-feature-risk-acceptance.mjs --output "$PWD/.local/p05-feature-risk-evidence"
node apps/risk-workers/scripts/p05-feature-risk-acceptance.mjs --verify "$PWD/.local/p05-feature-risk-evidence"
node --test apps/risk-workers/test/p05-feature-risk-acceptance.test.mjs
```

The second command must run in a separate fresh process after final promotion and before parent acceptance. The host must retain successful command outputs and its trusted receipt. Candidate-only results cannot close that gate. No runtime downloads, arbitrary command parameters, fake success mode, provider calls or database commands exist in this CLI. Importing it is inert. Programmatic entrypoints are `runP05FeatureRiskAcceptance({output})`, `verifyP05FeatureRiskAcceptance(output)` and strict `parseArguments(args)`.

The runner uses `openFeatureServingAdapter`, publishes actual private persisted stores, closes/reopens them, calls `serveFeatureRisk`, compares `replayFeatureRisk` to individual results, and calls `projectFeatureRiskAlerts` (which recomputes the bridge and uses existing alert projection). All writers close in `finally`; no child processes are launched. Four fixed fixtures each use at most six deliveries and one replay tuple. Existing contracts retain the absolute bounds of 2000 records and eight queries; the risk context's smaller existing bound remains authoritative.

Independent expected values assert duplicate/correction/reversal handling and exclusion of a future-available record: count `2`, amount `11.00`. A zero observation yields count `0`, amount `0.00` and an ineligible alert assessment. Missing and partial history remain withheld, with no candidates in these low-amount fixtures. Corrected complete history selects exactly `FRAUD_COUNT_VELOCITY`; flags remain unavailable, partial-alert exclusion is respected, and changing the alert policy version changes candidate identity. Currency conflicts, unknown scope, caller context conflicts, future observation times and forged/rehashed arithmetic are rejected. Stale and future publications stay unavailable. Exact decimal arithmetic and supplied UTC times come from the existing implementations; the runner supplies no wall-clock business time.

Evidence uses the existing owned-path conventions: absolute candidate `.local` paths, safe ancestors, private owned directories (0700), private regular single-link files (0600), no symlinks, bounded no-follow reads, canonical JSON, fsync and exclusive hard-link publication. Existing destinations are refused. Retention is bounded to 256 entries / 16 MiB; each evidence read is bounded to 2 MiB (canonical JSON reads to 1 MiB). The existing 180-second acceptance limit is preserved. No native timeout or disk reserves are changed. Failed runs retain their private diagnostic artifacts and cannot be reused as output destinations; cleanup is an explicit operator action.

`acceptance.json` binds actual source and compiled files and per-case input, risk policy, alert policy, publication and result hashes. The verifier reads without opening writers, reconstructs deterministic input and reducer state from the fixed fixture, recomputes serving/replay/projection, checks identities and exact file inventories, and rejects changed/missing artifacts or current-code hash mismatch. Hashes bind local artifacts; they are not signatures or verified source revision attestation. Source changes require a new run in a new directory. Tests verify fresh-process read-only behavior, no overwrite, corruption, missing files, symlink rejection and private permissions.

The trusted host still must run affected checks, automation, publication/security, source/plan/Git guards, root `pnpm typecheck`, `pnpm test`, `pnpm build`, and frozen offline `pnpm verify:fresh`. No root lint script exists. The sandbox's direct compiler and new subprocess tests are preliminary checks, not trusted host acceptance. Legacy suites needing `/tmp` database fixtures or localhost listeners run only under the host's tested permission profile. Do not lower reserves, change permissions, fetch dependencies or bypass guards.

All target requirements remain open under the authoritative [master](../../tasks/ralph/master.json) and [requirements map](../../tasks/ralph/requirements-map.md):

| Target | Local evidence / remaining target gate |
| --- | --- |
| P05-01 | Bridge and persisted serving are local progress; approved online feature/entity scope absent. |
| P05-02 | Preserve all fifteen detector families; real-source and owner policy review remain open. |
| P05-03 | Bounded immutable replay/policy hashes are local progress; historical eligibility and production approval/effective-date/rollback remain open. |
| P05-04 | Preserve statistical/model baselines; actual eligible peer/account baselines and cold-start validation remain open. |
| P05-05 | Preserve bounded temporal prototype; source/account identity, temporal graph coverage and unresolved markers remain open. |
| P05-06 | SQL/Python graph benchmark is the next separately activated batch after B12 final native acceptance. Neo4j/GDS adoption remains conditional on measured benefit. |
| P05-07 | Separate indices and evidence hashes are local progress; approved score meaning, real-source evidence and governance remain open. |
| P05-08 | Versioned candidates are local progress; durable alert integration, grouping, workload, yield, capacity and policy approval remain open. |
| P05-09 | Preserve existing MLflow lineage; eligible experiment evidence/labels and accuracy limitations remain open. |

P06 requires a monitoring/evidence integration gap review against the canonical portal. P07 retains recipient/device/provider gates. P08 requires eligible labels and model governance. P09 requires actual LMPS contract and authority. P10 retains security/operations gates. P11 requires gated release/handoff. Existing master task IDs and dependencies remain authoritative. This run activates none of those phases and makes no automatic production adoption, provider, account-switching, deployment or tracker changes. The user explicitly directed the current-profile continuation; the parent recorded a manual handoff from pluse to plusb. Original task text retains the earlier pluse registration. No automatic account rotation, logout or replacement of an existing login occurred.


Independent RLP-B12 host acceptance — 2026-10-30T05:01:49.934Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.


Parent promoted-source acceptance — 2026-10-30:

All five B12 receipts are verified. Parent rebuilt current promoted source, ran the actual P05 acceptance CLI into .local/p05-b12-final-20261030 and ran its read-only verifier in a separate fresh process. Both commands exited 0; all four fixture bindings passed, evidence bytes/inodes/mtime stayed unchanged and OS inspection found zero owned trial processes. Immutable results and hashes are under .local/ralph/batches/rlp-b12/parent-final-20261030/ and completion-audit.json in that batch directory. See ../implementation-status/current.md for verification history and remaining gates.
