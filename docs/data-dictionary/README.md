# Source DDL inventory

[No.40.1 source semantics contract and validation](../operations/source-semantics.md) binds source-owner declarations to the No.39.1 pilot evidence, reports unknown codes and15-pattern prerequisites, and preserves unverified account/business identity. Declaration coverage alone does not enable real risk assessment.

## Offline export readiness — No.35.1

[CSV export/profile contract and CLI](offline-dataset-profile.md) describes the bounded file-only profiler. [Offline import/reconciliation — No.35.2](offline-dataset-import.md) adds restricted unverified staging with replay/checkpoint checks. [All planned tables, implemented columns and source/system lineage](table-column-lineage-catalog.md) separates draft logical design from17 local/synthetic +2 offline tables. Neither tool approves source semantics. [No.35.3 Offline Risk Replay](offline-risk-replay.md) adds a separate simulation-only amount screening report, without operational Alerts or verified account assumptions.

## Synthetic lifecycle definition — No.25.1

[Synthetic lifecycle codebook](synthetic-lifecycle-codebook.md) and its [versioned JSON](synthetic-lifecycle-codebook.v1.json) define invented payment/lookup, original status and reversal codes with golden fixtures. No.25.2 adds a [local normalizer](synthetic-normalizer.md); No.25.3 adds an [offline frozen-snapshot pipeline](synthetic-normalization-pipeline.md) using explicit separately bound synthetic evidence. Actual source integration remains pending; all real-source semantic/identity gates remain UNVERIFIED.

Item 5 analyzes the local `LMPS_Risk/lmps_schema.sql` file without contacting MariaDB or importing it into PostgreSQL. Generated metadata is in [JSON](lmps-schema/metadata.json) and [the readable inventory](lmps-schema/report.md). The report records the input fingerprint, parser version, coverage and explicit omissions. Usage/tests are in the [tool guide](../../tools/schema-metadata/README.md).

## Observed declarations — 2026-10-17

- **100 tables, 1,581 columns, 345 keys/indexes:** 66 primary keys, 58 unique keys, 221 ordinary indexes; one declared foreign key.
- `transfer` and `transfer_hist`: primary key `(id, requesttime)` and unique key `(reference, requesttime)`.
- `transfer_old`: primary key `(id)` and unique key `(reference)`.
- `transfer.amount` is declared `decimal(24,2)`. Money units, currency mapping and reversal semantics still need owner confirmation; no source-to-contract conversion is implemented.
- `fromaccount`, `toaccount`, `frommember`, `tomember`, relevant time/status fields and related history/backup tables exist as structural candidates. These names do not prove stable account linkage, routing/owning bank equivalence, executed-funds semantics, history overlap or trustworthy labels.

All 100 table/1,581 column/345 key declarations were independently reconciled against the source declaration counts. That checks inventory completeness for those structures, not full SQL semantic correctness or equivalence to the running database.

## Coverage is partial

There are **31 explicit coverage issues**: 14 column CHECK expressions, eight table constraint expressions, four generated expressions, four CREATE tails/syntax constructs and one executable comment are not fully extracted. The four CREATE prefixes retain their column/key inventory; partition/storage/constraint semantics are not certified. No claim is made that this file could be executed successfully or that live configuration matches it.

Comments/defaults/sample values/raw SQL were excluded from reports. The original SQL file was not copied into the new repository or modified. Only synthetic DDL is used by the tool tests.

## Before actual sync

Confirm account identity/masking and ownership; source business payment identity and cross-history deduplication; exact time/status/currency codebooks and historical availability; live schema/row statistics; replica/binlog compatibility, permissions, impact budgets and measured lag. The different declared keys above are a reason to investigate, not permission to UNION history tables or pick `id` alone as a global payment key.

No MariaDB connection, PostgreSQL schema, CDC/sync, account resolver or performance/capacity result is delivered by this inventory.

## Source mapping and logical design — item 7

[Source Mapping](source-mapping.md) and its [machine-readable draft](source-mapping.json) scope four candidate tables and cover every existing Transaction wire field. [PostgreSQL Logical Model](../architecture/postgresql-logical-model.md) separates lineage, immutable revisions, current projections, assessments, alerts and cases; it includes query/index candidates and physical-design gates. These are DRAFT_FOR_REVIEW with 13 unverified semantic/access gates, not approved capture config, runtime conversion or migrations. New synthetic cases test widths, money and identity counterexamples in the existing Python/Node suites.
