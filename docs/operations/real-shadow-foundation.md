# No.47.1–51.1 — evidence, replay, labels, evaluation and persistent shadow

These batches extend the local experimental foundation. All source access in this workflow is from existing private files; the supplied `lmps_schema.sql` is parsed, never executed. Owner codebook, account identity, historical availability and real ground truth remain unverified. The real271-row pilot therefore stays unavailable for model training/scoring. The real2GB flash-drive trial remains deferred. No payment action or production release is enabled.

| Batch | Delivered local behavior | Evidence boundary |
| --- | --- | --- |
|47.1|DDL-bound, exact money/time normalization with source/mapping/document/review hashes|Owner declarations are observations, not independently verified business truth or account entities|
|48.1|SQLite-backed temporal feature replay, checkpoints, exclusive writer, immutable chunks and bounded training cohort|100k invented rows and actual SIGKILL/resume tested; not the real2GB file or production capacity|
|49.1|Append-only independent label adjudication, revocation, maturity and frozen exports|Only explicit synthetic fixture evidence can become eligible; external resolutions remain unverified|
|50.1|Frozen same-cohort rules/statistics/model comparison, calibration-only capacity thresholds and candidate selection|Real evaluation stays unavailable without eligible features/labels; selection never activates a model|
|51.1|Owned persistent PostgreSQL + pinned FastAPI + Core API, aggregate metrics, restart and PG/ML recovery|Local component readiness is separate from production readiness; overloaded calls are visible503s|

Run commands from `financial-crime-platform/` with its pinned toolchain and installed locked dependencies. Private inputs/outputs use absolute paths,0700 directories and0600 regular single-link files. Do not print tokens or place private evidence in Git. See the [earlier ML contract](ml-shadow.md) for training, feature definitions, signatures and rollback.

## 47 — structure and evidence-bound observations

```sh
pnpm dataset:normalize-real \
  --adapted "$PWD/.local/no39-real-pilot/adapted" \
  --schema /Users/macbookpro/Documents/LMPS_Risk/lmps_schema.sql \
  --output "$PWD/.local/new-real-normalization"
```

The output parent must already exist and be private. `normalized.json` and `mapping.json` are immutable. Exit2 means a valid report contains unavailable rows; exit1 means validation/publication failed. The supplied DDL has26 `transfer` columns and all22 pilot fields, with `amount decimal(24,2)`. Primary key `(id,requesttime)` and unique `(reference,requesttime)` do not establish account identity. `transfer_hist`/`transfer_old` are not automatically unioned; their overlap and lifecycle remain unknown.

The draft mapping leaves observations unavailable. When an owner supplies an actual document, use `--mapping`, `--review` and `--document` together. Mapping uses the existing [Source Semantics contract](source-semantics.md), with `status=owner_declared` and the document SHA in its evidence. Review JSON has exactly these fields:

```json
{
  "format": 1,
  "mapping_sha256": "<canonical mapping SHA256>",
  "ddl_sha256": "<raw DDL SHA256>",
  "document_sha256": "<raw document SHA256>",
  "reviewer_ref": "owner_review_reference",
  "reviewed_at": "2026-10-25T02:00:00Z",
  "snapshot_observed_at": "2026-10-25T01:00:00Z",
  "currency_exponents": {}
}
```

Populate exponents from confirmed currency definitions when interpreting minor units. Never infer major/minor units from `decimal(24,2)`. Conversion uses integer arithmetic, rejects rounding/fractional cents and unresolved negative money. Explicit timezone conversion rejects ambiguous/nonexistent local times. An observation's availability is the declared snapshot time, not the original transaction time. Review cannot predate the snapshot. Reversals and original-reference linkage remain unavailable. Targets, sender/receiver entities and net executed amounts remain absent. Even successfully bound declarations retain `source_semantics=unverified`, `owner_authenticated=false`, `independently_verified=false` and no canonical emission/enforcement.

## 48 — checkpointed feature replay

Input is private JSONL of the existing strict `Event` schema from `lmps_ml/dataset.py`. Configuration contains the `DatasetInput` fields except `rows`; `source_sha256` must match the complete raw JSONL bytes. This is a feature engine input contract, not permission to label raw LMPS observations as verified events.

```sh
pnpm ml:pipeline replay --source /absolute/private/events.jsonl \
  --config /absolute/private/config.json --output /absolute/private/replay
pnpm ml:pipeline cohort --replay /absolute/private/replay \
  --output /absolute/private/cohort --maximum 2000
```

Restart the exact replay command after interruption. `--stop-after N` provides a planned checkpoint stop. An OS lock fences competing writers. Source/config/code/prefix hashes, SQLite state and published chunks are checked before reuse; changed input requires a new output. Latest known revisions replace earlier state once; future or late corrections/reversals cannot change already frozen historical decisions. Same sender/currency history uses a one-hour window and exact integer money. Business duplicates/conflicting revisions are guarded.

Limits:1m events,2GiB JSONL,16KiB per line,500-row checkpoints,1000-row immutable feature chunks,10k events per decision window. Overflow is unavailable. The training/evaluation cohort remains at most2000 deterministically selected row IDs, with explicit sampled-cohort provenance; it does not represent full-population detection quality. Unknown real semantics/identity remain unavailable throughout replay.

Optional invented scale/recovery trial, in a **new** private directory:

```sh
uv run --locked --directory services/ml-inference python -m lmps_ml.replay_scale \
  --root /absolute/private/new-scale-trial --rows 100000
```

Actual local trial:100000 rows; SIGKILL after checkpoint1000; complete resume;5 reference parity checks;25.539s including recovery/parity,17.137s resume section;557337710B retained source/state/chunks. Reported91308032B peak RSS measures the parent Python process only, excluding the killed child, PostgreSQL and OS. This is not an overall memory envelope or a5-million-payments/day result.

## 49 — independent labels and frozen feedback

Migration0016 adds `platform.local_label_adjudications`; newly upgraded isolated fixtures/runtime have31 total tables and17 migrations. The original project database remains28 tables/15 migrations. Case outcomes continue to be opinions; closing a Case does not create training truth.

Typed endpoints:

- `GET /v1/local/cases/:caseId/label-candidates`
- `GET /v1/local/labels/:labelId`
- `POST /v1/local/cases/:caseId/labels/:labelId`

Reads require `labels:read`, `cases:read`, `risk:read`, `alerts:read`; writes also require `labels:adjudicate` and the configured policy writer. Scope is `synthetic_local`. See `packages/contracts/src/label-review.ts` for the strict request: request/version IDs, outcome version, linked Alert, task,0/1/null outcome, adjudicate/revoke action, maturity time and evidence kind/reference/hash. Actor comes only from the JWT. Independent reviewer must differ from both outcome actor and current assignee. The Case must be closed with current outcome/evidence; its existing advisory lock serializes transitions and adjudication.

Recorded review time is the database time. Effective maturity cannot precede recording; unknown labels never become negatives. Reopen, newer outcome/evidence or revocation makes current eligibility unavailable while preserving history. Only explicitly invented `synthetic_fixture` evidence is eligible; `external_resolution_unverified` stays unavailable. App/writer roles cannot update/delete/truncate the ledger or spoof recorded metadata.

Export a private JSON array of label UUIDs, then attach matching targets/revisions/tasks:

```sh
LMPS_LOCAL_STATE_DIR=/absolute/private/shadow/pg \
  pnpm labels:export /absolute/private/label-ids.json \
  /absolute/private/label-exports <new-run-uuid>
pnpm ml:pipeline attach-labels --dataset /absolute/private/cohort \
  --labels /absolute/private/label-exports/v1/<run-uuid>/labels.json \
  --output /absolute/private/labeled-cohort
```

The state directory must be the runtime's `pg` directory; do not substitute the original project's database. Export is a frozen as-of snapshot: exact retry of a run UUID validates/reuses its bytes; use a **new run UUID** to observe later revocation or Case changes. Attach validates record hashes, rejects ambiguous target/task labels and rebuilds lineage before fitting. Exported Case opinions cannot promote real unverified source features. Historical evaluation results stay historical and must be regenerated from a refreshed export when truth changes.

## 50 — same-cohort comparison and candidate review

```sh
pnpm ml:pipeline evaluate --dataset /absolute/private/labeled-cohort \
  --root /absolute/private/shadow/ml \
  --references /absolute/private/references.json \
  --output /absolute/private/evaluation --capacity-per-thousand 50
```

References are a JSON array of registered `{name,version,artifact_sha256}` pins, at most5. Request evidence binds dataset, code, rule context and model versions. Actual MLflow runs retain comparison artifacts. Fraud/Mule/AML use the same eligible calibration/test cohort within each task, minimum20 eligible rows and5 examples of each class per split. Missing coverage is unavailable, not a zero metric.

Comparisons include a fixed amount reference, train-only median/MAD, actual Isolation Forest and registered Logistic Regression/LightGBM. When the original bounded synthetic event context can be proven against feature hashes, the existing15-detector TypeScript engine also runs; missing flags can make a task's rules comparator unavailable. Replay-derived cohorts do not fabricate missing context. A risk index/novelty score is not a calibrated probability; Brier is reported only for probability models.

Thresholds and candidate selection use calibration only, including capacity ties; the final test cohort reports held-out metrics with Wilson precision/recall intervals, ROC/AP and day segments where defined. Candidate-for-review is not deployment approval, and evaluation never changes the registry deployment. Reviewed-cohort sampling remains explicit; no population quality or real LMPS winner is claimed. Actual retained invented480-row evaluation completed3 task reports; actual271-row real evaluation returned unavailable for all3.

## 51 — persistent owned runtime, health and recovery

Initialize once in a new private root. It creates its own PostgreSQL cluster, MLflow/models/keys and synthetic fixtures, applies migrations only there, backs up and stops. It refuses the original project's state directory and unowned existing roots.

```sh
pnpm shadow:runtime init --root /absolute/private/new-shadow
pnpm shadow:runtime start --root /absolute/private/new-shadow
```

Start stays in the foreground; Ctrl+C stops the owned child services. In another terminal:

```sh
pnpm shadow:runtime status --root /absolute/private/new-shadow
pnpm shadow:runtime stop --root /absolute/private/new-shadow
```

Default loopback ports: Core API18511, ML18512, private control18513. `init` accepts `--api-port`, `--ml-port`, `--control-port`. Root holds `pg/`, `ml/`, `config.json`, private control token, `access/<role>.json`, status and acceptance evidence. Short-lived scoped JWT files are refreshed while running; do not copy their contents to logs. The supervisor warms the pinned model and verifies its unique instance ID/artifact SHA, fences a second writer, and controls only its own child handle/validated owned cluster. Start validates migrations but never applies new ones automatically. Restart retains database/model/key/label state; metrics are process-scoped and reset.

Configured ML `/health/ready`200 means pinned loading/warmup passed. Runtime `local_components_ready` means its owned components respond. Core API bootstrap `/health/ready` remains503 for unresolved system gates; `production_ready=false` remains explicit. Authenticated `GET /v1/shadow/metrics` reports aggregate completion/reason/status counts, latency buckets, probability histograms and a train-reference first-feature PSI only after50 observations. It retains no raw target/features. PSI is distribution change, not detection performance; unavailable labels remain explicit.

Run the full invented worker→HTTP model→Alert→Case→independent label/export→metrics→PG/ML recovery demonstration against an initialized, stopped runtime:

```sh
pnpm shadow:demo /absolute/private/new-shadow
```

It closes the runtime on completion. Stable fixture IDs let exact repeats validate existing evidence. The fixture's zero confirmation threshold checks plumbing only and is not a recommended risk policy. Acceptance reports contain no private tokens. Actual run:100 model HTTP calls/concurrency8,35 accepted and65 explicit503 busy; all-response p95=12.022ms, accepted p95=13.478ms. A separate50-call controlled probe exercises drift and is excluded from load percentiles. This small overload check is not a payment SLA/capacity pass.

PostgreSQL backup/isolated restore uses the existing database tools; the new ledger is included in inventory and pre-label30-table/pre-model28-table backups remain supported. ML recovery is separate:

```sh
pnpm ml:pipeline backup --root /absolute/private/new-shadow/ml \
  --output /absolute/private/new-ml-backup
pnpm ml:pipeline restore --bundle /absolute/private/new-ml-backup \
  --output /absolute/private/new-restored-ml
```

Take the ML snapshot while the supervisor is stopped and no fitting/registration writer is active. It snapshots local MLflow SQLite, pinned artifacts, deployment and private auth/signing files under the deployment lock. Limits:200 files,64MiB total,16MiB per file. Restore requires a new nonoverlapping directory, validates all hashes before writes, explicitly relocates local MLflow file URIs with a receipt, preserves version IDs/artifact bytes/keys, then warms/verifies the deployed and all registered versions (max50). An empty default experiment URI is logged/skipped; remote or outside-root active artifact URIs fail closed. Actual persistent acceptance restored PostgreSQL31 tables and3 registered ML versions; signed inference also survives restore in native tests.

Portal Vite8.1.6 replaces8.0.5 without design/token changes. Separate online Node audit reports0 high/0 critical, with5 low/4 moderate still present. SBOM has233 components/0 UNKNOWN. Offline verification does not perform online advisory checks.

Native test packages run sequentially, with at most2 test files at once inside database/API/worker suites. This bounds simultaneous disposable PostgreSQL/model processes. The combined Node verification budget is360s and the fresh verification budget600s; individual runtime/database timeouts are unchanged. An initial fresh attempt exceeded the former180s combined budget; another exposed a parallel fixture database-creation timeout. Neither attempt counts as a pass.

## Evidence and remaining gates

Private local evidence lives under `.local/no47-51/`: real normalization/evaluation,100k replay recovery, invented evaluation, owned `shadow/acceptance/*/report.json`, and before/after primary database backups. Original28-table fingerprints were unchanged. See [current status](../implementation-status/current.md) for the final fresh-source suite result and audit date.

Still required before real claims: owner-confirmed codebook/money/time/reversal rules; source connection and approved sync boundaries; verified identity/masking; point-in-time historical availability; independent mature real labels and representative sampling; the deferred2GB trial; production monitoring/ownership/capacity and release gates. No graph/DL/GNN, account enforcement or live payment action is implemented by these five batches. The historical27.6% full-plan score has not been rescored.
