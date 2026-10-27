# Manual LMPS export → Mac → flash drive → cleanup

Approved manual workflow, 2026-10-23. The operator runs the commands; development/testing does not connect to the real source. The target is **2,000,000,000 UTF-8 TSV bytes before gzip**, including each file's header. Finish the current hour before stopping, so the result can exceed the target by one hour. If the selected range ends first, report the actual size and exit 2 without claiming 2 GB or deleting staging copies.

The single-file tool is [export_transfer.py](../../apps/risk-workers/scripts/export_transfer.py). It requires Python 3.12+ and an existing `mariadb` or compatible `mysql` client for export. Offline verification/cleanup needs only Python. No pip install, PostgreSQL, backend service or migration is required.

## Small v2 pilot — 22 columns, before taking data home

The approved pilot adds `fromaccount`, `toaccount` and `fee` to the existing19 fields. Declarations were checked directly against `../lmps_schema.sql`: `fromaccount VARCHAR(200) NOT NULL`, `toaccount VARCHAR(5000) NOT NULL`, `fee DECIMAL(24,2) NULL`, with the composite PK `(id, requesttime)` and `idx2_transfer(requesttime)`. The script uses live `SHOW COLUMNS`, `SHOW INDEX` and `EXPLAIN PARTITIONS` before reading records. A missing required column or a plan without a timestamp-leading indexed range stops before the sample SELECT. No source schema/index change is made.

Run on the Mac:

```sh
scp /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/apps/risk-workers/scripts/export_transfer.py admin@175.3.1.35:/home/admin/lmps-export-pilot.py
ssh -t admin@175.3.1.35 'python3 /home/admin/lmps-export-pilot.py --pilot-v2'
```

Enter the actual DB connection/read-only user as before. This mode reads only `[2026-10-01 00:00:00, 2026-10-01 00:01:00)` by default and publishes at most1,000 rows. `--start` can select another whole-hour starting point; pilot end is always one minute later and the v1 byte target/date-range options do not control this mode. The SELECT uses `LIMIT 1001` to detect truncation while storing at most1,000 rows. It has no ordering or random-sampling claim. This is a small format/coverage sample, not complete history or an assessment of all15 patterns.

Output is a new0700 `/home/admin/lmps-export-pilot-v2-<id>` with0600 files:

- One `.tsv.gz` with22 columns. **This private data file contains source account-field values.** Escaping, exact money and leading zeros follow v1; no identity normalization, hashing or account linkage is performed.
- `profile.json`: NULL/empty counts and account-field shape counts/maximum lengths. Numeric text, JSON object/array, mask markers and the `000201` prefix are only heuristics; they do not prove an account, mask collision freedom, QR validity or ownership. No raw values/examples/account hashes/distinct-account counts are included. Identity stays `unverified`.
- `preflight.json`: selected column declarations and indexed query-plan evidence; estimated rows are not observed counts.
- `manifest.jsonl`: v2 format/columns, one-minute boundary, row cap/truncation, private artifact hashes and a final `pilot_complete` or failed status. The profile and preflight hashes are bound to the completed summary.

After `pilot_complete`, copy the whole folder to the Mac Desktop. Replace `<id>` with the printed suffix; this block refuses to overwrite an existing folder:

```sh
(
  set -e
  umask 077
  LMPS_PILOT='lmps-export-pilot-v2-<id>'
  python3 -c 'import re,sys; sys.exit(0 if re.fullmatch(r"lmps-export-pilot-v2-[A-Za-z0-9_-]+", sys.argv[1]) else "Invalid pilot folder")' "$LMPS_PILOT"
  test ! -e "$HOME/Desktop/$LMPS_PILOT"
  scp -rp "admin@175.3.1.35:/home/admin/$LMPS_PILOT" "$HOME/Desktop/"
  python3 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/apps/risk-workers/scripts/export_transfer.py --verify "$HOME/Desktop/$LMPS_PILOT"
)
```

The reader automatically verifies v1 or v2, including v2 companion reports. Bring the whole verified folder to the flash drive for home testing; retain compressed originals and manifest. The verified-copy cleanup guard also accepts completed pilot bundles with exactly their manifest-listed artifacts, using the same home/Desktop boundaries. On the server use the updated `lmps-export-pilot.py` for a pilot's verify/cleanup commands. Actual cleanup still follows flash-copy verification. Existing failed runs remain for separate inspection.

This pilot does not import into PostgreSQL, run real Risk scoring, create verified account entities or resolve source status/currency/time/reversal semantics. Member/QR dictionaries, status history, adequate baseline/history and an authoritative flagged-account feed remain subsequent inputs. No such source is invented from member/merchant block tables.

## 1. Copy the tool to the server, then run it there

Run on the Mac:

```sh
scp /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/apps/risk-workers/scripts/export_transfer.py admin@175.3.1.35:/home/admin/lmps-export-2gb.py
```

Run in the interactive Terminal on `app01`:

```sh
python3 /home/admin/lmps-export-2gb.py
```

Enter the **actual MariaDB host**, existing read-only username, port and password. The export machine 175.3.1.35 is not assumed to be the database endpoint. Password input is hidden, never passed in arguments/environment or written to the dataset. A 0700 temporary authentication directory contains a 0600 client option file, removed after normal completion, handled exceptions or Ctrl-C. Existing client option files/TLS options still apply; user-level password settings may override an extra option file. SIGKILL, host loss or power failure cannot run process cleanup.

The exporter sends a read-only `SELECT 1` startup probe and a generated allowlisted `SELECT JSON_OBJECT(...) FROM transfer WHERE requesttime >= literal AND requesttime < literal`. No SQL `SET`, transaction controls, server-side OUTFILE, writes, schema/index changes, grants, ordering, row-limit truncation or source/history union is generated. The client uses `--init-command=SELECT 1`; an empty `--init-command=` executes empty SQL and fails with 1065. Safe-updates defaults and automatic reconnect are disabled. `--quick` streams rows rather than buffering the result set. Queries run sequentially with a 2-second pause between hours.

Defaults are 2026-10-01 00:00:00 inclusive through2026-10-23 00:00:00 exclusive. Explicit overrides use `--start`, `--end`, `--target-bytes`, `--host`, `--user`, `--port` and `--output-root`; date boundaries must be naive whole hours and one run is limited to 31 days. No timezone conversion is performed. Server timezone configuration +07/SYSTEM does not certify stored DATETIME business semantics.

The tool prints its new 0700 `/home/admin/lmps-export-2gb-<id>` directory and progress for each hour. Keep that Terminal open until the final summary. Files are 0600:

- `transfer_YYYYMMDD_HHMM_YYYYMMDD_HHMM.tsv.gz`: one full hour, including empty hours, with its own 19-column header. Extracting gives `.tsv`.
- `manifest.jsonl`: format/columns/target/time boundaries, verified completed windows, row counts, exact raw/compressed byte sizes and SHA-256 for both representations, followed by the run summary. No host/password/raw record values.
- `.part`: incomplete/unpublished output after a failure; never treat it as a completed hour. Earlier verified files remain intact. A rerun creates a new directory; there is no automatic resume or dataset merging.

Before publishing each file, the client must exit 0 and the gzip is fully decompressed to check CRC, byte count, physical record count and raw SHA-256. Publication cannot overwrite an existing final file. A failed run records `interrupted_or_failed`, exits 1 (Ctrl-C 130), and retains completed windows for inspection. Only `target_reached` exits 0.

Client failures include the error number when available, e.g. `MARIADB_SELECT_FAILED_ERROR_1045`, without echoing diagnostics, credentials or record values. Unsupported options get `MARIADB_CLIENT_OPTION_UNSUPPORTED`; unclassified failures retain `MARIADB_SELECT_FAILED`.

## 2. SCP the completed dataset back to the Mac

Replace `<id>` with the suffix printed by the exporter. This block refuses to merge into an existing Mac folder. It performs no cleanup.

```sh
(
  set -e
  umask 077
  LMPS_BUNDLE='lmps-export-2gb-<id>'
  python3 -c 'import re,sys; sys.exit(0 if re.fullmatch(r"lmps-export-2gb-[A-Za-z0-9_-]+", sys.argv[1]) else "Invalid export folder name")' "$LMPS_BUNDLE"
  test ! -e "$HOME/Desktop/$LMPS_BUNDLE"
  scp -rp "admin@175.3.1.35:/home/admin/$LMPS_BUNDLE" "$HOME/Desktop/"
  python3 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/apps/risk-workers/scripts/export_transfer.py --verify "$HOME/Desktop/$LMPS_BUNDLE"
)
```

After `VERIFIED`/`target_reached` exit 0, **copy that whole folder to the flash drive yourself**, including `manifest.jsonl`, without renaming its contents. The flash copy can be inspected or extracted, but keep the original `.tsv.gz` files and manifest until cleanup verification finishes.

## 3. Verify the flash drive, then remove only the server/Mac staging copies

Run this on the Mac **after copying to the flash drive**. Fill both variables. The flash root must be the mounted volume itself, e.g. `/Volumes/MyUSB`, not a new directory on the Mac. Leave the drive connected through verification/cleanup. This block does not delete the flash copy.

```sh
(
  set -e
  LMPS_BUNDLE='lmps-export-2gb-<id>'
  LMPS_FLASH_ROOT='/Volumes/<flash-drive-name>'
  LMPS_TOOL='/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/apps/risk-workers/scripts/export_transfer.py'
  python3 -c 'import os,re,sys; sys.exit(0 if re.fullmatch(r"lmps-export-2gb-[A-Za-z0-9_-]+", sys.argv[1]) and os.path.ismount(sys.argv[2]) else "Check export folder name and mounted flash volume")' "$LMPS_BUNDLE" "$LMPS_FLASH_ROOT"
  LMPS_FLASH_COPY="$LMPS_FLASH_ROOT/$LMPS_BUNDLE"
  sync
  python3 "$LMPS_TOOL" --verify "$LMPS_FLASH_COPY"
  LMPS_FLASH_MANIFEST_SHA=$(shasum -a 256 "$LMPS_FLASH_COPY/manifest.jsonl" | awk '{print $1}')

  ssh admin@175.3.1.35 bash -s -- "$LMPS_BUNDLE" "$LMPS_FLASH_MANIFEST_SHA" <<'REMOTE'
set -e
python3 /home/admin/lmps-export-2gb.py --cleanup-copy "/home/admin/$1" --verified-manifest-sha256 "$2"
rm -- /home/admin/lmps-export-2gb.py
if [ -d /home/admin/lmps-export-20261001-00-01.e9kyCa ]; then
  rm -f -- /home/admin/lmps-export-20261001-00-01.e9kyCa/query.sql
  rmdir -- /home/admin/lmps-export-20261001-00-01.e9kyCa
fi
REMOTE

  python3 "$LMPS_TOOL" --cleanup-copy "$HOME/Desktop/$LMPS_BUNDLE" --verified-manifest-sha256 "$LMPS_FLASH_MANIFEST_SHA"
  printf 'Cleanup complete. Retained dataset: %s\n' "$LMPS_FLASH_COPY"
)
```

Every cleanup rechecks the source gzip/raw contents and the exact manifest hash from the verified flash copy. It requires a direct child of the current user's home or its real, non-mounted Desktop named `lmps-export-2gb-<id>`, a reached target, and exactly the manifest-listed files. Wrong hashes, corruption, unlisted files, symlinks, failed/incomplete targets or a path outside that boundary stop deletion. It unlinks only manifest-listed files and removes the empty folder; it never recursively deletes a supplied path. The old one-hour folder is removed only after deleting its known `query.sql`; `rmdir` stops if anything else remains. The repository tool/tests/docs remain as project source.

Verification is integrity relative to the manifest, not a signature or proof of business/source authority. Cleanup is not atomic: filesystem/SSH failures can leave some staging files; the verified flash copy remains the retained dataset. No cleanup command is run by development/tests against actual server, Mac exports or a real flash drive.

## Format and scope

Columns, in order: `id, requesttime, txtime, reference, frommember, tomember, totype, amount, ccy, result, responsetime, txtype, originalreference, shouldrevert, isreconciled, issettled, settletime, qrtype, fromchannel`. No accounts, fromuser, purpose or receipt are selected. All result codes, zero/negative amounts and lifecycle values are retained without interpreting them.

UTF-8 escaped TSV: literal TAB separates fields, LF separates records, `\N` represents NULL. For non-null values, backslash/TAB/CR/LF/NUL become `\\`, `\t`, `\r`, `\n`, `\0`. Thus a literal text `\N` becomes `\\N` and remains distinct from NULL and empty text. Quotes are ordinary characters, not CSV quoting. A reader must first split physical tabs, recognize exact `\N` as NULL, then decode escapes on other fields. Exact money remains the source DECIMAL(24,2) string; preserve routing leading zeros as text.

Separate hourly SELECTs are **not one consistent database snapshot**. No global payment deduplication, history-overlap resolution, verified account identity, canonical mapping or Risk decision is performed. This 19-column TSV/gzip format is not the existing 6-column CSV importer contract (64MiB/100,000 rows per file); real-data import/adaptation is a separate batch.

## Verification during development

```sh
python3.12 -W error -m unittest discover -s apps/risk-workers/test -p test_export_transfer.py -v
pnpm test:source-export
pnpm exec node --test apps/risk-workers/test/source-export-native.test.mjs
pnpm security:scan
```

The standard-library suite uses invented data, real temporary gzip/file copies and a subprocess client stub. It checks byte thresholds/full windows, allowlisted SELECT/DDL projection, exact decimal/UTF-8/NULL/escapes, private credentials, client failure/oversize/termination/redaction, non-overwrite publication, manifest/hashes, offline copied-file verification, and cleanup proof/path/unrelated-file/retained-copy boundaries. A separate native suite reuses the disposable TLS MariaDB fixture: it reproduces 1065 with the old empty option, verifies the new SELECT-only startup, exports an invented row through the production exporter, and checks native error redaction. Fixture setup/teardown never accesses the real source, persistent project databases or removable media. Root `pnpm test` includes both suites; full/fresh project verification is a separate reported result.

References: [MariaDB client](https://mariadb.com/docs/server/clients-and-utilities/mariadb-client/mariadb-command-line-client), [option-file escaping](https://mariadb.com/docs/server/server-management/install-and-upgrade-mariadb/configuring-mariadb/configuring-mariadb-with-option-files), [Python gzip](https://docs.python.org/3/library/gzip.html).
