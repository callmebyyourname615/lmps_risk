# Local synthetic pre-transfer replay

## RLP-B01 acceptance handoff (2026-10-25)

US-105 adds `test/pretransfer-acceptance.test.mjs`: actual concurrent retries are checked against the binding registry and exact reservation accounting; a separate deterministic scenario checks pre-request callbacks, changed money/parties, duplicate/conflicting outcomes and expiry equality. Run after `pnpm build`:

```sh
pnpm exec node --test packages/contracts/test/pretransfer-simulation.test.mjs packages/risk/test/pretransfer-simulation.test.mjs packages/risk/test/pretransfer-reservations.test.mjs apps/risk-workers/test/pretransfer-simulator.test.mjs apps/risk-workers/test/pretransfer-acceptance.test.mjs
```

Actual candidate run: 29 passed, 0 failed/skipped (27 existing simulator tests + 2 acceptance tests). This includes existing actual root/worker subprocess publication, immutable private report replay, failed-command redaction, resource/state/queue caps and independent interleaving coverage. Root `pnpm typecheck` and `pnpm build` passed with pnpm 11.20.0 / Node 24.22.0. An earlier premature test invocation failed two worker imports because build output did not yet exist; the post-build command above passed. No historical 970-test result is counted here.

Promotion is pending the independent host's full worker/root suites (including the requested Existing26 baseline), publication/secret and protected-source guards, and `pnpm verify:fresh`. Online advisory checks: SKIP (network prohibited). No new dependency was added. The simulator is local/synthetic only: no actual LMPS endpoint, authority, G-ONLINE, production capacity or verified identity is established; real 2GB verification remains deferred.

The trusted runner owns verification/promotion receipts for US-101 through US-105. This candidate does not edit its tracker or certify unseen receipts. Before promotion the host must confirm each prerequisite receipt and runner A0–A2, skip already-promoted tasks on resume, and stop the queue after its fifth task, US-105. No sixth task or rerun of prior implementation is authorized here.

This file-only simulator has no database, source, network, provider, real-model or payment integration. It grants no production authorization. Inputs and reports use `local_synthetic`, `test`, `simulation_only=true`, `enforcement=false`, `production_ready=false`. Real-source/export bundles are rejected by the strict scenario schema.

Supply three absolute paths: scenario JSON, separately trusted caller fixture JSON, and report directory. Use invented data only. The caller fixture is not corporate authentication; it must not come from an untrusted request body. Both JSON files must be owner-only regular files, owned by the current user, with one link, in owner-only directories. Each file is bounded to 64KiB; scenarios contain at most 200 commands. Existing private-file helpers enforce these checks without relaxing them.

Scenario and caller shapes are defined in `packages/contracts/src/pretransfer-simulation.ts`. The scenario requires explicit capacities, initial clock, synthetic scenario/run IDs and contract version. Commands are request, lookup, outcome and strictly forward clock advance. References can be derived from the US-102 binding contract; no reference is production authority. Clock advances expire pending reservations through the outcome library. Missing capacity remains unavailable.

From the repository root, with private files prepared:

```sh
pnpm risk:simulate-pretransfer /absolute/private/scenario.json /absolute/private/caller.json /absolute/private/reports
```

From `apps/risk-workers` after building:

```sh
pnpm build
pnpm exec node scripts/pretransfer-simulate.mjs /absolute/private/scenario.json /absolute/private/caller.json /absolute/private/reports
```

The report is `reports/v1/<caller-and-run-digest>/report.json`. Retries with identical input and code reuse it; changed scenario, caller configuration or code under the same scoped run fails without overwrite. Use a new synthetic run ID for an intentional new run. A failed/partial publication is retained and fails closed. Reports bind scenario, caller/capacity configuration, contract and executable code digests, with counts and accounting invariants. No wall clock or random value enters results. Counts describe synthetic in-flight capacity, not balances, settlement or real capacity. Console output contains status/counts only; errors intentionally withhold diagnostics and paths. Exit codes are 0 for a stored/reused report and 1 for invalid input, unsafe storage or conflict; individual simulated rejections appear in report counts.

The worker test suite exercises the actual root command, root/worker CLI execution, deterministic retry, conflict preservation, unsafe files, expiry, binding lookup and outcome replay. Host scope/publication checks and broader batch acceptance remain external gates; no production readiness is claimed.

Candidate verification on 2026-10-25: `pnpm --filter @lmps/risk-workers typecheck`, `pnpm --filter @lmps/risk-workers build`, and `pnpm exec node --test apps/risk-workers/test/pretransfer-simulator.test.mjs` passed (3 tests). The subprocess test ran the root command and the documented worker-directory `pnpm exec node` invocation against private invented fixtures, and checked configuration conflicts preserve the original report. Tests also checked executed/failed/cancelled duplicate and conflicting outcomes, expiry at equality, count-only stdout, and bounded caller-file rejection with withheld diagnostics. The full `pnpm --filter @lmps/risk-workers test` suite and host scope/source/publication checks are pending independent host verification; they are not counted as passed here.


Independent RLP-B01 host acceptance — 2026-10-25T08:31:42.920Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.
