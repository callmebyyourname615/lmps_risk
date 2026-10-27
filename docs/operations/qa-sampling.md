# Local synthetic QA sampling

Run `pnpm risk:sample-qa /absolute/caller.json /absolute/pool.json /absolute/policy.json /absolute/reports` at the repository root. After build, the worker command is `node apps/risk-workers/scripts/qa-sampling.mjs CALLER POOL POLICY OUTPUT`. All four paths must be absolute.

Only invented local_synthetic/test fixtures with simulation_only=true, enforcement=false and production_ready=false are accepted. Caller is separate from pool/policy. Inputs are limited to 4 MiB each; reports to 1 MiB. Unchanged private JSON helpers enforce ownership, private modes, single links, regular files, strict UTF-8 and bounded reads. Input parent directories and output parent must be owned private directories. Use mode 0600 files and 0700 directories.

Reports are stored under OUTPUT/v1/ID/report.json. ID deterministically hashes validated caller and pool_id, defining an immutable run slot. Exact canonical retries acknowledge the existing report; changed pool/policy content conflicts. Use a distinct synthetic pool_id for a separate run. Exclusive directory creation prevents concurrent replacement. Partial publication fails closed and requires private operator inspection; never delete another writer's files. Console reports fixed status and aggregate counts only.

Fractions describe only the supplied fixture pool. Missing/insufficient strata and future evidence exclusions remain explicit in the private report. No labels, negatives, weights, training eligibility, population representation or detection accuracy are established. The CLI introduces no database, source/provider or network operation.

O-010 authority, real source coverage/identity/masking, production sampling/maturity policy and production approval remain open. Independent host scope, manifest, source/publication guards and full worker/root suites remain pending durable host receipts. Online advisory checks are not run here. The final acceptance task appends actual evidence to implementation-status history; this task preserves that protected file.

Candidate checks executed: `pnpm --filter @lmps/risk-workers build` and `pnpm --filter @lmps/risk-workers typecheck` passed. `node --test apps/risk-workers/test/qa-sampling.test.mjs` passed 3 tests, including actual worker/root command smoke, retry/conflict, mode/hard-link/symlink/FIFO/UTF-8/size rejection and concurrent/partial publication. Full legacy integration suites and independent guards are host-only pending checks; these candidate results do not establish batch completion or production readiness.

## US-204 local acceptance handoff — 2026-10-25

Executed in the isolated candidate: worker build, worker typecheck and root `pnpm typecheck` each exited 0. Reported command versions: Node v24.19.0 and pnpm 11.20.0. The following focused command exited 0 with 19 passed, 0 failed, 0 skipped (contracts 8, selector 5, worker CLI 3, new acceptance 3):

```sh
node --test packages/contracts/test/qa-sampling.test.mjs packages/risk/test/qa-sampling.test.mjs apps/risk-workers/test/qa-sampling.test.mjs apps/risk-workers/test/qa-sampling-acceptance.test.mjs
```

The new acceptance exercises contract validation through the worker selector and actual private CLI: Alert/non-alert isolation; exact fractions; missing/insufficient strata; equality at supplied as_of and future exclusions; input immutability; reordered retry; changed-seed conflict preserving report bytes; distinct caller report slots; redacted invalid caller/time/duplicate/status/selection/row/byte-cap failures; unavailable files; and the exact 10000-row/1000-selected boundary. The focused existing tests additionally exercise the root command, report-byte limits, independent ranking reference, collision tie-breaks and private publication protections.

CLI subprocesses in the new tests deny socket connections/listeners, HTTP(S), fetch, datagram creation and external-process calls. Successful guarded runs and fixture-directory contents are regression evidence for the exercised path, not proof of whole-repository isolation. Reports validate against the strict result contract and are recursively checked for label/training/outcome/weight/accuracy claim fields. No persistent project database, real inputs or provider was used. Selection fractions describe only invented supplied fixtures; no representative population or real accuracy is established.

Independent host gates remain PENDING: Existing49 plus new trusted automation; full worker/root tests; pinned root typecheck/build and frozen offline `pnpm verify:fresh`; secret/publication/source/exact-manifest guards; and preservation of B01 receipts/tracker, original plan, Git, unrelated edits and all three logins. The local root typecheck result does not replace that fixed host invocation. Online advisory audit: **SKIP** (network prohibited), never PASS.

Only the trusted coordinator may establish promotion/completion with durable independent receipts. Host must confirm predecessor lineage and receipts, skip already receipted tasks on resume without duplication, and terminate the finite B02 queue after US-204. No tracker/automation/login/Git mutation is part of this task. Host must append its actual results to status after checks pass. O-010, source/identity/masking, real sampling/maturity and production gates remain open; production_ready=false.


Independent RLP-B02 host acceptance — 2026-10-25T12:49:48.514Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.
