# Local synthetic batch schedule/resume contract v1

US-307 / P08-07-T1 is a dependency-ready local foundation only. It does not adopt
Airflow, install dependencies, run a daemon, acquire data, train a model, register
or activate a model, or close target scheduling/adoption gates.

## Explicit entry

From the existing prepared offline Python environment, use the additive pipeline
command (all existing commands retain their behavior):

```text
python -m lmps_ml.pipeline batch-plan --plan /private/plan.json --output /private/run
```

The paths must be absolute, owned private local paths as enforced by existing
`lmps_ml.private` IO. Files require owner-only permissions and a single hard link;
directories require owner-only permissions. The parent output directory must
already exist. Environment must pass the existing local/test execution guard.
No input-provided shell, import, source path, URL, clock, cron, or action arguments
are resolved. CLI diagnostics withhold private input and exception details.

## Plan and version bindings

The strict top-level object has exactly `version` (integer 1), `namespace`
(`synthetic_` plus 1–40 lowercase letters/digits/underscores), `input`, `policy`,
and `tasks`. Input embeds the existing versioned strict DatasetInput object;
provenance must be `local_synthetic`. Existing feature definitions, dataset hash,
point-in-time, identity, availability and label safeguards remain authoritative.
Invented labels are fixture declarations, never real training evidence.

Policy is exactly `{"version":1,"max_attempts":2}` (attempts may be 1–3).
Example task list (input is supplied separately as the validated object):

```json
[
  {"id":"features","action":"dataset","dependencies":[]},
  {"id":"summary","action":"summary","dependencies":["features"]}
]
```

Task IDs match `[a-z][a-z0-9_]{0,31}`. Unknown fields, coercion, duplicate IDs or
dependencies, missing dependencies and cycles are rejected before execution.
Ready tasks use lexical ID order in a deterministic topological traversal.
The fixed trusted action table contains only `dataset` (existing `build_dataset`,
blocked when no features are available) and `summary` (hash-only lineage receipt).
Summary does not assert model quality, label authority or activation readiness.

Canonical SHA-256 binds the normalized versioned plan, full input and policy.
Each task hash binds its definition, input/policy hashes and dependency artifact
hashes. Artifacts carry version 1; dataset artifacts include the existing feature
and dataset version/hash evidence. Namespace and input version changes conflict
with the existing run. Task list permutations normalize; dependency lists are
ordered contract input. Hashes bind local evidence, not external authenticity.

## Ownership, interruption and retry

The output root owns one persistent private `writer.lock` inode. A nonblocking OS
file lock rejects a concurrent writer; process termination releases ownership.
Do not delete/replace the lock or edit checkpoints while a run exists. No timeout
steals ownership. This is a cooperating single-host filesystem contract, not a
distributed lock or protection against a malicious same-user process.

Each attempt records `running` before invoking an action. Before publishing a
complete artifact, a `publishing` checkpoint binds its expected SHA-256.
Checkpoints use private
exclusive temporary creation, fsync, atomic replace and directory fsync. Immutable
artifact publication reuses existing private publication and exact byte retry
comparison. Complete checkpoints bind artifact hashes; resumes reread and verify
them and skip those actions. Tampering/missing artifacts stops the run.

`--stop-after N` deliberately checkpoints an interruption after N newly completed
tasks. Resume by issuing the same explicit command. A crash while `running`
consumes an attempt; explicit resume may repeat that deterministic action within
the budget. A crash after artifact publication but before the complete checkpoint
resumes by verifying the publishing checkpoint's artifact hash and skipping the
action, even when the attempt budget is exhausted. If publication never created
an output directory, a new attempt remains subject to the original budget.
A partial artifact directory is
never accepted as complete and conflicts fail closed; there is no automatic cleanup.

Failed/blocked stages stop the entire traversal, including unrelated later tasks.
The CLI returns status and `checkpoint_sha256`, with exit 1 for failed, blocked or
deliberately interrupted runs. Complete/exact repeated runs exit 0. Retry a
failed/blocked checkpoint only with `--retry-ack HASH` equal to its current hash;
missing, stale or mismatched acknowledgement stops without running another stage.
Acknowledgement cannot change the plan or reset the finite attempt budget.
Exhaustion requires operator review; no automatic new run or unlimited retry.

## Local resource limits and verification handoff

Limits are local fixture safeguards, not business thresholds or capacity claims:
1 MiB canonical plan/read limit, 1–16 tasks, at most 16 dependencies per task,
1–3 attempts per task, 16 MiB per artifact and 1 MiB checkpoint/read limit.
Existing DatasetInput bounds include at most 2,000 rows. No silent truncation.
One output artifact per task and one replaceable checkpoint bound run outputs;
all loops traverse finite tasks/attempts. Runtime duration is bounded by these
local deterministic actions, not a distributed wall-clock timeout guarantee.

New unit/subprocess tests cover order/cycles, strict input and limits, binding
conflicts, exact retry acknowledgement, failed/blocked stop, exhaustion, concurrent
process lock rejection, interrupted checkpoint reuse, crash publication retry and
artifact verification. Actual candidate check results are reported in the task
handoff. Root checks, frozen fresh Python verification, source/field/publication
guards and the independent durable host receipt remain pending host verification.
`docs/implementation-status/current.md` is outside this task's exact allowlist and
is intentionally left for the authorized host/final batch handoff.

Candidate verification on 2026-10-25 used the prepared offline environment:
`PYTHONPATH=services/ml-inference .venv/bin/python -m pytest services/ml-inference/tests/test_batch_schedule.py services/ml-inference/tests/test_ml_dataset.py services/ml-inference/tests/test_ml_pipeline.py`.
Result: **36 passed in 10.92s**, including 26 batch tests and 10 existing
dataset/pipeline tests. Recovery tests include a crash after publication at the
one-attempt limit, changed published output rejection, interrupted action budget
consumption and partial publication stop. No full-root/frozen-fresh or host guard
result is claimed by this candidate.


Independent RLP-B03 host acceptance — 2026-10-25T16:39:21.802Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.
