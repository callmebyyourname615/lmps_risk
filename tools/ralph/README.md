# Local Ralph automation

## Registered complete plan (current entry point)

The complete original plan is registered in [master.md](../../tasks/ralph/master.md) and [master.json](../../tasks/ralph/master.json):104 MUST requirements,12 phases,23 sessions and135 leaves. At registration4 local B02 leaves are verified,9 local leaves are registered as US-301–309 in B03, and122 leaves remain blocked by declared owner/adoption/external/user-owned/release gates. B01 remains a separate completed5-task history. Registration does not start Codex or implement application features.

Use the project launcher from the project directory:

```sh
cd /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform
./tools/ralph/launch.mjs status --batch rlp-master
./tools/ralph/launch.mjs run --batch rlp-master --home plusb
./tools/ralph/launch.mjs resume --batch rlp-master --home plusb
```

Omit `--headless` for the native TUI; add it for logs. First execution uses run; interrupted work uses resume. The master routes only the registered eligible B03 queue to native Ralph, serially. It never sends blocked leaves to an agent or creates/approves new feature scope itself. When all9 registered tasks finish, master status reports13 verified local leaves and122 blocked leaves; it never declares the full plan complete. This registration currently fits all ready work into one batch; it does not claim a general automatic cross-batch provisioning framework.

`master.json` is a custom catalog, **not** a native Ralph `--prd` file. The native B03 tracker is separately compiled and bound to exact task/manifest/check/proposal hashes. Original plan hashes are checked. A post-registration user/source change stops first execution for review; after activation durable source/receipt chains govern resume. Completed B01/B02 tracker/receipts are sealed and stay readable despite later approved tooling changes.

The B03 registration configures only fixed scoped host quality checks for its local tasks. An explicit run/resume starts that execution scope; registration itself does not run application checks, access auth contents, invoke an AI agent, install new dependencies or make external calls. Coding agents remain workspace-write and cannot edit their own tracker, manifest, gates or automation guards. Existing ChatGPT homes are selected with --home; there is no automatic quota retry/rotation, logout, API-key fallback or production action.

Storage preflight and cache retirement remain enabled. For master-registered tasks, candidate dependency copies (`node_modules` and `.venv`) are additionally retired only after a durable verified receipt and an unchanged candidate-source check. Candidate source/notes/logs/receipts and original stores stay intact; changed/pending candidates are preserved. Recreating retired dependencies would require the recorded frozen offline setup, not re-running completed work.

For manual account handoff after the prior writer stopped, use resume with `--home pluse --handoff` (or another existing home) on the master or active B03 batch. A normal same-account resume omits --handoff. Stop reasons and underlying execution state appear in master status. No installed command predicts remaining account quota or waits for quota reset automatically.

## Approved RLP-B01 queue

RLP-B01 is authorized for five sequential synthetic pre-transfer tasks, US-101 through US-105. One launch continues automatically after each independently verified task. It stops on failure, a decision, interruption, quota or completion of this batch. New batches require review; the agent cannot invent or expand its queue. The original US-001 pilot tracker, receipt and baseline are retained separately.

From any terminal, first enter the project:

```sh
cd /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform
./tools/ralph/launch.mjs run --batch rlp-b01 --home plusd --headless
```

Keep that terminal and the Mac running. In another terminal in the same directory:

```sh
./tools/ralph/launch.mjs status --batch rlp-b01
```

After a safe interruption, inspect status, resolve its reported blocker, then resume on the same account:

```sh
./tools/ralph/launch.mjs resume --batch rlp-b01 --home plusd --headless
```

The launcher preserves existing logins and changes the selected home only through an explicit user request. No automatic quota polling or retries are implemented. A resume reconciles durable receipts, task dependencies, Git/source hashes and partial promotion before continuing pending work. Completed tasks are skipped. User edits or policy changes stop the queue; they are never discarded. A live/stale launcher lock is never forcibly stolen. Once this batch is activated, plain status/run/resume selects it automatically.

The custom launcher now also supports an explicitly requested manual account handoff. Choose one of these commands when the previous launcher has stopped:

```sh
./tools/ralph/launch.mjs resume --batch rlp-b01 --home plusb --handoff --headless
./tools/ralph/launch.mjs resume --batch rlp-b01 --home pluse --handoff --headless
./tools/ralph/launch.mjs resume --batch rlp-b01 --home plusd --handoff --headless
```

Run one command at a time. `--handoff` belongs to this project's launcher. It confirms the target's existing ChatGPT login without running login/logout, reconciles receipts/source/candidate state under the single-writer lock, records from/to homes, and continues only pending work. An ordinary resume requires the recorded home. Each explicit handoff updates the home shown by status and its resume command. The workflow never automatically changes account after a usage limit; quota still stops the queue. Opening an interactive Codex session alone does not start Ralph.

Codex edits an isolated source copy with workspace-write and never receives unrestricted execution. Host-owned policy checks the exact file allowlist and manifest fields, runs fixed verification commands, checks the original checkout for conflicts, journals promotion and syncs a task receipt before releasing completion to Ralph. Temporary candidate source, private agent notes, check outputs, recovery journal and receipts are retained under `.local/ralph/batches/rlp-b01/tasks/US-XXX/`. The post-edit file gate is an additional host control, not native per-file sandboxing. Existing credentials, `.env`, datasets and database state are not copied. Offline cached dependencies only; cache or sandbox failures stop execution. Read [the approved task contract](../../tasks/ralph/batches/rlp-b01.md) for limits and acceptance criteria.

The initial activation requires automation regression tests, a disposable boundary probe, and a real one-file Codex write smoke. US-105 additionally requires the full typecheck, test, build, publication scan and fresh-source verification. Online advisory audits remain explicitly skipped in this offline batch. Source semantics, identity, real labels, live integration and the real 2GB trial remain unverified/deferred.

Runner integration excludes `tools/ralph` from the Python workspace's `tools/*` glob. This tooling folder is not a Python package; dependency versions and lockfiles remain unchanged. Offline candidate setup explicitly reuses the verified local Corepack/pnpm/uv caches and installed Python interpreter while the verifier uses a separate home.

Pinned NVM executable paths use the operating-system account home, so an anonymous verifier HOME cannot redirect them into a missing `.nvm` directory. This does not alter or copy authentication homes.

The installed pnpm11 uses `pnpm_config_store_dir` for the cloned private cache; `npm_config_store_dir` is ignored. A real CLI regression checks the resolved `v11` store path under an anonymous HOME before fresh offline verification.

The coding agent keeps its restricted candidate workspace and private temp directory. A separate `lmps-local-fixtures` profile was tested with localhost access, denial of direct remote traffic, and protection of host guards. Actual PostgreSQL initialization still fails there because macOS rejects shared-memory `shmget`. The user explicitly approved normal host verification processes for only the fixed US-104/105 quality checks. That exception uses ordinary macOS user permissions for tests; its private approval record binds the proposal, task IDs, command policy and runner digest. It grants no extra coding-agent permission. Missing or mismatched approval keeps checks sandboxed or stops them.

Existing tests create their own random `/tmp/lmps-*` fixtures; no persistent project database is selected. The verifier uses a short owned temp directory and private APFS clones of cached packages, including the versioned pnpm `v11` layout. Its configuration, approval record, caches and check logs remain outside the agent's writable candidate. Agent notes may honestly leave full host checks pending; only the mandatory independent host checks and durable receipts complete a task. Online advisory checks remain skipped in the offline acceptance run.

Reviewed runner repairs are recorded as maintenance boundaries containing the old/new policy digests, complete source snapshots, exact tooling files and actual regression evidence. The receipt chain retains earlier evidence and rejects application, plan or Git changes in a maintenance boundary. Resume preserves pending application edits while updating those protected tooling files; completed tasks remain skipped. Ralph's runtime-only tracker `metadata.updatedAt` is reconciled independently of task definitions and completion flags.

## Historical read-only US-001 pilot

This setup executes only the approved read-only US-001 intake audit. It does not authorize application features or automatically execute104 plan requirements. The [approved scope](../../tasks/ralph/approved-batch.md) and [requirements map](../../tasks/ralph/requirements-map.md) preserve the sibling plan and its unresolved owner gates. No production/source/database command, deployment, Git commit/push, login/logout or automatic account rotation is included.

## Pinned tools and authentication

The launcher selects existing Node24.22.0 from the workspace, pnpm11.20.0 and Codex0.164.0 from the Node24.19.0 NVM installation, Python3.13.15 from `.venv`, and Ralph0.12.0/Bun1.4.4 from Homebrew. This avoids the different Homebrew Node/pnpm/Codex installations found during assessment. Paths are in `state.mjs`; changed installations require review, not silent PATH fallback.

The default is the existing `~/.codex-plusd`. Explicit `--home plusb` or `--home pluse` can select another existing home for a new approved run, while US-001 pilot resumes require the previously selected home. RLP-B01 supports another existing home through an explicit `resume --handoff` request. No credential file is read/copied by these scripts; normal Codex authentication/token refresh is left to Codex. No login/logout command is executed. No provider/API credential environment variables are inherited.

For this pilot Codex runs with explicit `-a never`, `--sandbox read-only`, `--ignore-user-config` and `--ignore-rules`. Ignoring user configuration is invocation-only: it prevents hooks/provider/sandbox overrides from changing the pilot and does not rewrite the selected home's configuration or authentication. The CLI's default supported model is used; model/provider customizations from the profile are intentionally not applied. Session history stays under the selected CODEX_HOME. Normal token refresh can update Codex-owned authentication state; the scripts never log out an existing session.

Ralph's `fullAuto` is false because its0.12.0 plugin otherwise sends `--full-auto`, rejected by both installed Codex versions. The adapter accepts only the approved argument shape and task ID. Outer Ralph has no fallback agents, no retries, abort-on-error, no automatic commits and no parallel execution. It starts from an owned empty runner directory to avoid Bun auto-loading the application's `.env` at startup.

Configuration schema version is explicitly2.1. The first attempted pilot exposed Ralph's implicit configuration migration: it installed bundled skills for detected Claude/Codex agents and seven global Ralph templates, then rewrote the project configuration. The source guard stopped before a real Codex request. These global bundled assets are left intact rather than deleting potentially pre-existing user files. The pinned schema and regression test now prevent that migration on subsequent runs; no login/logout occurred.

## Commands

Run from `financial-crime-platform/`:

```sh
./tools/ralph/launch.mjs status
./tools/ralph/launch.mjs checkpoint
./tools/ralph/launch.mjs verify
./tools/ralph/launch.mjs run --home plusd --headless
./tools/ralph/launch.mjs resume --home plusd --headless
```

Omit `--headless` for the TUI in an interactive terminal. The pilot always has at most one Ralph iteration and only one approved task. No unlimited/watch mode exists in this launcher. Use it instead of invoking Ralph directly: direct invocation bypasses the outer source/checkpoint/lock reconciliation, although the adapter still refuses unapproved tasks and unsafe arguments.

`checkpoint` explicitly accepts the reviewed tooling snapshot only if original application files and all11 plan documents still match the private pre-setup baseline. It permits changes only to `.gitignore` and the implementation-status document among the415 original files; newly added tooling is included in the checkpoint. It is not a general feature-change approval mechanism. Do not refresh a checkpoint just to suppress an unexpected edit. It never resets or stages Git changes, recreates a tracker or clears completion receipts.

`verify` checks the104-item map against its exact generator/input ledger, the pinned Node/pnpm/Python versions, the automation regression suite, the existing publication/secret scanner and source/plan/branch/index preservation. It does not rerun all application tests or claim the previous970 tests as current evidence. The application package scripts/lockfiles and original plan remain unchanged. Database-heavy checks such as `pnpm verify:fresh` remain available for a later approved feature batch.

## Completion and evidence

Raw Codex JSONL/tool output is parsed in memory with bounded buffers, not forwarded into Ralph logs. Only fixed progress messages are shown. Completion-looking source/tool text cannot finish a task. A successful exit also cannot finish it: the final structured audit must match the approved task/counts/blockers, and independent verification must succeed. Only then does the adapter write a private receipt and emit the Ralph completion marker.

State is under ignored `.local/ralph/` and `.ralph-tui/*.json`; task definitions and configuration are Git-visible. The pre-setup baseline contains verified private copies of415 source files and11 plan documents. It is a source backup, not a database backup or a Git commit. `.env`, private datasets, existing runtime state and credentials were not copied. No automatic restore is provided.

The tracker is `tasks/ralph/prd.json`, initially generated by installed Ralph's converter from `approved-batch.md` with branch metadata `main`; no branch/commit was created. A receipt written before a crash can repair a missing `passes` update after source/task/plan reconciliation, avoiding another Codex request. A completed tracker without a matching receipt fails closed. Completed work is skipped without invoking an agent.

## Failure, interruption and usage limits

The adapter separates provider quota/usage failures from authentication, network, ordinary coding, incomplete reports, failed verification, interruption and timeout. It inspects structured error events and failed-process stderr; quota-related text in source/tool responses is ignored. Exit75 indicates quota,77 authentication,65 failed verification,78 state/config review,124 timeout and130 interruption. Only explicit machine-readable retry/reset times are recorded; no reset is guessed and no time-based retry loop runs.

On quota: keep the current task unfinished, wait for the same account to become available, inspect `status`, then explicitly call `resume`. The wrapper selects native Ralph resume when its iteration budget remains. Failed/completed-but-unverified or budget-exhausted sessions are archived privately before a fresh one-iteration run with the same tracker. This happens only on the explicit resume command after source/task/process reconciliation; it is not an automatic retry. Completed verified work is skipped. No force flag is used. A Ctrl+C is forwarded; interruption/crash leaves Git changes intact. The underlying model is forcibly terminated after a bounded grace period if it ignores termination.

A live or stale launcher lock blocks new runs; it is never silently stolen. After a force-kill, inspect the recorded launcher/Ralph processes and task state. `./tools/ralph/launch.mjs recover-lock` refuses live recorded processes or active Ralph task state and does not delete Ralph's own lock. It is an explicit recovery action, not a retry loop. If a process or state is ambiguous, keep the lock and investigate.

Terminal output and private state report manual action requirements. Background monitoring, desktop notifications, automatic quota recovery and automatic account handoff are not installed. This setup is a bounded intake pilot, not yet a general unattended feature implementation runner.

## Tests without real Codex usage

```sh
./node_modules/.bin/node --test --test-concurrency=1 tools/ralph/automation.test.mjs
./.venv/bin/python -B ci/security.py
```

Fixtures use invented reports, temporary Git repositories and a fake agent. One integration test runs the installed Ralph loop against an invented quota-failing executable with a temporary HOME and no real authentication. Tests never invoke the real Codex agent, change an existing login or operate the application's databases.

To add a future implementation queue, review the selected gaps, exact checks, write scope and execution policy with the user first. This read-only adapter deliberately rejects such work until a separate batch is approved.
# Registered queues and complete-plan preparation (2026-10-25)

RLP-B01 is preserved as completed historical evidence. RLP-B02 (user-approved R0 + US-201–204) adds only local synthetic QA sampling records. The registry binds exact manifest/task/proposal hashes and the sealed B01 receipt inventory. Unknown/tampered batches fail closed. Existing B01 receipt/tracker files are never reset to accept a later batch.

From the project directory:

```sh
./tools/ralph/launch.mjs status --batch rlp-b02
./tools/ralph/launch.mjs run --batch rlp-b02 --home plusb --headless
./tools/ralph/launch.mjs resume --batch rlp-b02 --home plusb --headless
```

`run` is for first execution. `resume` reconciles durable receipts, source/plan/Git/task definitions and unfinished candidate before continuing; it does not wait for quota reset. Completed tasks are skipped. An explicit manual `resume --home pluse --handoff` can select another already logged-in account; there is no automatic account rotation, login/logout or retry. A completed B01 run/resume reports historical completion without invoking an agent. After registration, omitted `--batch` selects the registered active batch; explicit `--home` is recommended.

Each registered batch is finite and serial. Coding agents retain workspace-write sandbox restrictions. The separately approved ordinary-host verification is limited to fixed R0/US-201–204 checks on disposable fixtures; registration does not grant that exception to other future batches.

Disk preflight requires6GiB free before candidate/agent execution and seeding a private verifier cache, and2GiB before checks using an already seeded cache. These are local safety reserves, not guaranteed peak-space estimates. A verified task's reproducible cache clone is retired only after its durable receipt; candidate source, test logs/receipts and original package stores are preserved. ENOSPC stops the task without promotion. Archive any Ralph-created uncommitted tracker temporary before source reconciliation; never remove an unrelated user file to clear the source guard. Native interrupted-session metadata is not trusted as a completion receipt.

The complete104-MUST/12-phase/23-session planning map is at [.local/ralph/proposals/full-plan/README.md](../../.local/ralph/proposals/full-plan/README.md). It is a reviewed-source preparation artifact, not a native Ralph tracker. `backlog.planning.json` must never be supplied as `--prd`: native Ralph cannot enforce its owner/adoption/external/user-owned gates. A future cross-batch dispatcher must be separately implemented and verified; the current launcher continues automatically only inside the selected registered batch. Exact manifests and verification authority must be in place before any planned leaf is executable.

