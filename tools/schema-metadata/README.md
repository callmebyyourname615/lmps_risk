# Offline DDL metadata tool — item 5

Read a local UTF-8 MySQL/MariaDB DDL dump, inventory table declarations, and write metadata-only JSON/Markdown. SQL is never executed. The tool has no database client, DSN, query, CDC, network request or source-data sampling operation. Installation/auditing can use package registries; analyzing a file is local.

## Run from the repository root

```sh
uv sync --all-packages --locked
pnpm schema:metadata --input ../../../lmps_schema.sql --output-dir ../../docs/data-dictionary/lmps-schema
```

The pnpm command delegates to `uv run --locked --directory tools/schema-metadata python -m lmps_schema`. Paths passed to it are relative to **`tools/schema-metadata`**, because uv changes directories. Absolute paths are accepted. The example input resolves to the sibling `LMPS_Risk/lmps_schema.sql`; the output stays inside the new repository. To refresh existing generated reports, add `--overwrite`. Neither output target may be the input file, including aliases through symlinks, hardlinks or case-insensitive filenames.

Initial dependency downloads may need `--system-certs` for an approved native certificate chain; keep TLS verification enabled. Once cached, `uv run --locked --offline --directory tools/schema-metadata python -m lmps_schema ...` runs without registry access.

| Exit code | Meaning |
| --- | --- |
| 0 | Complete for the explicitly supported inventory subset; not full DDL/database validation |
| 1 | Input/output/size/encoding/internal error; do not assume a current report pair exists |
| 2 | Reports written with **partial coverage** and explicit issue codes; inspect them before relying on the inventory |

The LMPS file currently returns **2**, as expected from its unsupported/omitted constructs. Treating this as success code 0 would conceal those limitations.

## What is extracted

- CREATE TABLE declarations, safe schema/table/column identifiers, parser-normalized types and numeric type parameters.
- Explicit or inferred nullability, implicit NOT NULL for primary keys/auto-increment, and generated-column flags.
- Inline/table primary and unique keys; ordinary/fulltext/spatial indexes, column order, prefixes and ASC/DESC direction.
- Table-level foreign keys, ordered local/remote columns and recognized referential actions.
- Name/type-based field candidates and history/backup name candidates, all explicitly unverified.
- Input byte count/SHA-256, pinned parser/dialect, counts and coverage issues. No absolute input path is included.

SQLGlot **30.23.0** is the single added runtime dependency (MIT); tests use Python's standard `unittest`. Its **MySQL** dialect is used for this MariaDB dump. Parser-normalized `timestamptz` corresponds to MySQL TIMESTAMP and does not verify timezone/session settings. An unspecified TIMESTAMP's nullability remains unknown because server settings can affect it. Ordinary omitted NULL/NOT NULL is reported as the implicit MySQL nullable default; this is inferred DDL metadata, not a live check.

## Deliberate limits and privacy

This is an inventory of CREATE TABLE declarations, **not an interpreter of a migration script or final database state**. DROP/SET/USE are counted and not applied. ALTER, standalone CREATE INDEX, views, queries, INSERT/data statements and executable non-SET comments are flagged instead of applied. Duplicate table declarations are retained and flagged. No row count, actual uniqueness, blacklist trust, account identity, codebook, lag, binlog or performance conclusion follows from the inventory.

Comments, DEFAULT/ENUM/SET values, storage-option values, ON UPDATE expressions, raw SQL and parser exception text are not emitted. Index storage options are omitted, although key kind/columns/prefix/order are retained. CHECK/generated expressions and unknown constraints/properties are explicitly flagged. Unsupported CREATE tails can fall back to parsing only the balanced column-list prefix using parser token offsets; the table's columns/keys are retained, but coverage stays partial. This does not validate partition functions, bounds, pruning or retention.

SQLGlot warnings may contain SQL, so they are counted behind a temporary logging handler and never formatted/forwarded. Concurrent analyses need separate processes because that logging capture is process-global. Identifiers must match a bounded ASCII metadata profile; others are redacted and coverage is marked partial where detected. Exported schema identifiers and source fingerprints remain organizational metadata, not anonymized data.

Input is bounded to 10 MiB. Reports are deterministic and written atomically **per file**; the two files are not a transactional pair. Existing reports require `--overwrite`; after any exit 1, regenerate before using an old or incomplete pair. This is local tooling, not an authenticated upload service or a live database profiler.

## Verify

```sh
pnpm test:schema
```

Synthetic-only tests cover composite/inline keys, foreign keys, precision, prefixes/order/index kinds, nullability, semicolons in comments, redaction, parser failures/warnings, unknown syntax, executable comments, duplicate declarations, no network use, CLI exit codes, input preservation, output symlinks, explicit overwrite, UTF-8 and size bounds. No real dump is embedded in fixtures.

## References

- [SQLGlot parser, AST and error behavior](https://sqlglot.com/sqlglot.html)
- [MariaDB CREATE TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/create-table)
