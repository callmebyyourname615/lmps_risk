# Finite feature engine comparison handoff

US-905 is a local_synthetic acceptance wrapper. Production_ready=false. B09 closure requires the trusted parent host's promoted-source execution and independent fresh-process verification. Coding-agent tests, including internal loader doubles, provide no native proof.

From the project root, after the host's fixed offline build and source-plan-Git/publication checks, use a normalized absolute **new** destination beneath the private project `.local` directory. Its existing parents must be owned mode 0700. No symlink or overwrite is supported.

```sh
node apps/risk-workers/scripts/feature-engine-acceptance.mjs --output "$PWD/.local/b09-final-unique"
node --input-type=module -e 'const m=await import("./apps/risk-workers/scripts/feature-engine-acceptance.mjs"); await m.verifyFeatureEngineAcceptance(process.argv[1])' "$PWD/.local/b09-final-unique"
```

Exact APIs: `parseArguments(args)` accepts only `--output ABSOLUTE_NEW_PATH`; `runFeatureEngineAcceptance({output})` launches the actual default comparison; `verifyFeatureEngineAcceptance(output)` reads and independently revalidates existing evidence without starting engines. Import is inert. There is no runner, executable, receipt, environment fake mode or verification CLI flag. CLI diagnostics are fixed codes without payloads.

The wrapper calls `runFeatureEngineComparison`, which runs the B06 original bounded acceptance, matched original clean restart/replay, B08 extended contribution acceptance and matched worker, then the pinned Streams candidate. The frozen plan has 26 logical/39 physical Streams records and eight queries, one partition. Limits remain 2000 positioned records, eight queries, 2GiB owned scratch and 16MiB retained evidence. Each independent native trial has its own 180s deadline with teardown reserve; the aggregate wrapper ceiling is 600s, not a single native trial allowance. Observations preserve elapsed/setup/phase milliseconds, process output bytes and sampled peak scratch bytes. Sampling is not RSS measurement or a guarantee about production capacity.

Only the existing read-only runtime inventory verifier and owned supervisors select Java21, Kafka4.1.2, Streams4.1.2 and RocksDB JNI9.7.3. No installation, download, external broker, caller classpath or executable is accepted. Missing compatible artifacts fail closed. Owned brokers bind loopback only; no existing broker is reused. Native operations are parent-host-only.

Evidence is retained beneath `comparison/`: original captures, worker checkpoints/publications/cursors, bounded prefix, extended state, Streams phase rows/snapshots and native state file hashes, candidate receipt and immutable comparison report. Comparison verification recomputes expected original values and extended vectors, validates prefix/restart/replay positions and persisted state, and checks runtime/source/compiled/input hashes before and after. Acceptance additionally binds its script/test/runbook, reviewed B09 proposal/manifest, phase plan, root package and lockfile. Status documentation is append-only and intentionally outside this hash set so host check evidence can be appended. Receipt publication uses fsynced private staging and an exclusive hard link, then directory fsync. Cleanup uncertainty or mismatch prevents publication. Failed directories remain unaccepted; inspect only bounded diagnostics and select a new destination for recovery. Do not reuse or overwrite them.

| Case | Finite support |
| --- | --- |
| Original matched latest revision/currency/window net vectors | Independently asserted |
| Extended attempt/gross/reversal/net and unknown reversal | Independently asserted |
| Exact duplicate prefix replay and suffix after clean close | Persisted cursor/state checked |
| Single frozen hot key, explicit fixture timestamps/availability | Finite fixture only |
| Original attempt/gross projection and missing/history native queries | Unsupported |
| Native changed-duplicate, partial coverage, TTL admission | Unsupported native trials |
| Unclean crash, larger burst, Flink | Untested/unsupported |

Money uses exact decimal strings and Java BigInteger; completeness is never inferred from arrival. All policy/corpus semantics remain frozen. No p95, throughput/SLO, production winner, account semantics, legal/TCO or representative workload conclusion follows from these trials.

Host handoff: run all fixed automation, root/worker tests/typechecks/builds, frozen offline fresh/publication/source-plan-Git/prefix checks and durable promotion receipts. Then execute the final CLI on promoted source, verify in a fresh process, independently inspect current hashes and persisted evidence, and confirm no remaining owned OS processes using the supervisor ownership evidence. Fresh-process in-memory registries alone cannot prove another process has no leaks. Append actual receipts/check results to current.md only after success. B10 is separate. O-013/O-008/O-006/F-LEGAL, owner/adoption, representative workload, source/identity/masking, retention and SLO gates remain open.


Independent RLP-B09 host acceptance — 2026-10-28T08:35:09.209Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.
