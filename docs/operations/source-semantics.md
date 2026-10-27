# No.40.1 — LMPS source semantics and risk readiness

`dataset:semantics` validates a versioned source-owner declaration against the verified22-field evidence from No.39.1. It reads private files only: no LMPS connection, PostgreSQL write, migration, normalization, assessment or operational Alert is performed. The existing No.39.1 amount-screen policy/results remain unchanged.

## Run the real pilot as draft

From the repository root with the locked Node/Python workspace installed:

```sh
pnpm --silent dataset:semantics \
  --adapted "$PWD/.local/no39-real-pilot/adapted" \
  --output "$PWD/.local/no40-semantics" \
  --run-id 251c85a5-2f43-48cb-bd7b-9c854995b860
```

All paths must be absolute. The adapted directory must be the immutable No.39.1 output, including its receipt, CSV, lineage and original evidence files. Local/test mode is required. The output's parent must exist and be private0700; input files must be owned, private0600 regular files with one link. Linked/overlapping input/output, malformed, insecure or changed evidence is rejected. Files and decompressed input retain the64MiB pilot bound; sample rows are capped at1000. The earlier2GB dataset is outside this command's scope. The Python bridge is internal; its stdout is captured by the Node command, not an operator report.

Without `--mapping`, the command creates a draft from the observed lifecycle combinations and currencies. Operations/states are unknown, currency/units/time are null, and no source-owner evidence is invented. A syntactically valid existing mapping may be supplied with `--mapping /absolute/private/mapping.json`.

Console output contains only counts, generated IDs, mapping version and fixed statuses; errors use one fixed code. The detailed JSON is private and may contain literal source status/type/currency codes. Never publish it or the mapping without reviewing the data boundary.

Exit codes:0 means all rows are covered by an owner-declared mapping;2 means the report is valid but declaration coverage is partial/unavailable;1 means validation/publication failed. Exit0 is not independent evidence verification, risk readiness or a positive/negative fraud outcome. The actual draft command above normally exits2, including an exact retry.

## Outputs and immutability

Under the chosen output:

- `v1/<mapping_id>/mapping.json`: canonical mapping; `mapping_id` is a deterministic identifier derived from the version string. Console output supplies the ID.
- `v1/<run_id>/semantics.json`: mapping/source hashes, counts, exact code frequencies, lifecycle combinations, descriptive review counts, per-row source TSV hashes and15-pattern readiness.

Version content is immutable within this output registry. The run UUID also pins its complete report. Exact retries return duplicate; changed content, partial publication and tampering are preserved and rejected. A changed mapping needs a new version and a new run UUID. New source evidence needs an explicitly rebound mapping/new output scope. An input mapping file is a private editable copy; do not edit published mapping/report artifacts. Registries in different output folders do not establish a global approval authority.

Reports bind the source manifest SHA-256, original archive SHA-256 and adapter receipt SHA-256. The bridge rechecks every receipt-listed file, bounded gzip integrity, source rows, six-field CSV projection and full per-row lineage before producing observations. It rereads the file inventory after extraction to reject concurrent changes. Hashes establish content consistency, not authenticity of the LMPS export or the authority of a declaration.

## Mapping contract

The hand-validated TypeScript contract is `packages/contracts/src/source-semantics.ts`, exported as `@lmps/contracts/source-semantics`. Unknown fields, executable DSL, ambiguous duplicate selectors/currencies and invalid evidence/time/unit declarations fail closed. At most1000 lifecycle entries and32 source currencies are accepted; mapping JSON is capped at2MiB and bridge/report JSON at4MiB. Oversize input is rejected without truncation.

| Field | Required meaning |
| --- | --- |
| `format`, `execution_mode` | `1`, `offline_analysis` |
| `version` | Explicit `lmps_semantics_…` version, changed whenever content changes |
| `source_manifest_sha256` | Exact pilot manifest binding |
| `status` | `draft` or `owner_declared`; there is no self-assigned `verified` status |
| `evidence` | Null for draft; for owner declaration: opaque document/reference, actual evidence SHA-256 and `owner_role=lmps_source_owner` |
| `lifecycle[].source` | Exact tuple of `result,txtype,totype,shouldrevert,isreconciled,issettled`; NULL and empty text differ |
| `operation` / `state` | unknown/payment/lookup/reversal and unknown/pending/succeeded/failed; unknown operation requires unknown state |
| `currencies[]` | Exact untrimmed source currency code, declared three-letter currency, independently explicit major/minor amount and fee units; null remains unavailable |
| `time` | Null or explicit requesttime/request_received or txtime/business_occurrence with an explicit offset or accepted IANA zone |

Do not fill owner declarations from guesses, numeric-looking status codes, sample frequencies, a routing member name, the database server's timezone or a QR-looking account field. The tool validates declaration structure and sample coverage; it does not fetch/verify the referenced document or authenticate the owner. Independent verification and a separately authorized real normalizer/integration remain prerequisites.

To prepare for the owner's review, copy the generated draft to a private input file, keep all observed raw selectors unchanged, and supply the documented definitions. Use a new version and genuine evidence reference/hash only when the source owner has provided the interpretation. Generate a new run UUID with:

```sh
pnpm --silent exec node -e 'console.log(crypto.randomUUID())'
```

Then pass the reviewed private input through `--mapping` and the new UUID through `--run-id`. The supplied271-row sample cannot prove mapping coverage over unobserved codes, other time ranges, transfer history or future data.

## Interpretation and remaining gates

Unknown, missing and case/whitespace-mismatched codes remain unavailable without fallback. Draft suggestions never become effective declarations. Full declaration coverage means that lifecycle, currency/amount/fee units and time were supplied for every sampled row; it does not assert that those declarations are correct.

Review counts describe negative/zero amounts, null fees, observed original-reference presence, declared reversal candidates and raw naive-time order. They are not fraud findings or proof of a source contradiction. The tool uses exact integer cents for sign/zero checks and never converts currencies, scales units, rounds values or computes net executed money. The UTC-shaped date check only validates calendar syntax; it does not convert source times into verified UTC occurrence times.

Even an owner-declared successful reversal leaves `net_executed_amount=null` and reports `REVERSAL_LINKAGE_UNVERIFIED`. An originalreference being present does not verify a link, partial reversal, business-payment identity or current/history deduplication. No account values, references, member identifiers or source IDs are copied into this report; accounts remain in the original private22-field evidence.

All15 pattern codes/requirements come from the existing risk catalog. Reports distinguish missing declaration coverage from unresolved independent verification, business identity, net executed money and real-engine integration. Account-dependent patterns additionally retain identity/history/baseline/graph/flag blockers as applicable. No declaration in this phase enables a real detector or treats unknown as a negative result.

## Actual local acceptance — 2026-10-24

The existing271-row real pilot was revalidated without source connections. It contains4 distinct lifecycle selector combinations and2 literal currency codes. The automatically generated draft leaves271 rows unavailable for owner-declared semantics and all15 real patterns blocked. An actual second run returned duplicate publication with the same IDs and evidence binding.

Before/after verified local backups have identical fingerprints for all28 tables, including the271 staged pilot rows and the existing synthetic core data. Acceptance evidence is private at `.local/no40-semantics/acceptance.json`. No source account identity, business/status codebook, money units or event timezone has been newly certified. Physical-flash verification and export cleanup remain separate operator tasks.

Final verification passed900 offline tests:647 Node and253 Python checks, including20 new semantics checks. Frozen installs, typecheck/build, generated/lock drift, publication346 files and SBOM199/0 UNKNOWN passed; online advisory audits were skipped. The final strict inventory/SHA/UUID/number guards also retained duplicate publication for the actual271-row CLI retry.
