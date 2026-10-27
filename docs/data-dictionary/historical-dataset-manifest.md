# Local historical dataset manifest and writer port

US-302 / P03-06-T1 defines a local_synthetic/test contract only. No Parquet,
filesystem acquisition, object service, real account linkage or actual writer
adoption is implemented. P03-06 target writer/storage gates remain open.

The only IDs accepted have the `synthetic_` prefix and 1–64 ASCII letters,
digits, underscores or hyphens after it. These are invented fixture identifiers,
not account identities. The execution namespace binds workspace, run and dataset;
reuse is compared within that exact tuple.

Rows have exactly fixture_id, amount, currency, occurred_at and available_at.
Amounts are unsigned strings with exactly two decimal digits and at most twelve
integer digits (no leading zeros except zero itself). USD, THB and LAK are local
fixture codes with a fixed two-place representation, not verified source currency
semantics. UTC timestamps require milliseconds and valid calendar dates.
Availability is explicit: null means unavailable; otherwise it cannot precede
occurrence. Unknown fields, coercion, duplicate file/row IDs, accessors and input
code/schema/paths are rejected. Inputs are plain local data, never executable code.

Finite local limits: 1–4 files, 1–16 rows per file, at most 64 total rows,
3,072 UTF-8 bytes per canonical file and 12,288 total content bytes. IDs and
fixed fields bound manifest size as well (under 8 KiB). These are fixture limits,
not business thresholds or capacity claims. Over-limit input fails as a whole;
no slicing, rounding or silent truncation occurs. Row and file order are binding.

SHA-256 binds the fixed exported schema descriptor. Canonical content uses JSON
arrays with the fixed row key order; per-file descriptors bind invented file ID,
content hash, byte count and row count. The dataset content hash hashes that ordered
descriptor list. The complete manifest additionally binds namespace, version,
provenance, execution mode, exact row count, bytes, sorted currencies, inclusive
occurrence range, available/unavailable counts and latest known availability.
Validation recomputes every field from all supplied rows and returns detached
metadata. Changing any binding or omitting content fails validation.

HistoricalWriterPort requires atomic compare-and-publish of all content and the
complete manifest. Implementers must serialize namespace claims, privately stage
files, verify all bindings, and publish once, or publish nothing on failure.
Identical complete retries acknowledge; any changed namespace reuse conflicts.
The wrapper validates and detaches data before invoking this trusted port; it
cannot enforce atomicity in an arbitrary external implementation. The executable
in-memory fake demonstrates staging failures after first/last file, no complete
publication on failure, retry, changed-content conflict and concurrent claims.
There is no production store implementation or storage adoption claim.

Verification: current-task unit tests and contracts typecheck/build are run in the
candidate; actual results are reported by the agent. Independent host source,
field, publication/secret and required full checks remain pending. Only a durable
independent host receipt establishes completion. The implementation-status file is
outside this task's allowed changes and is reserved for the trusted handoff.
