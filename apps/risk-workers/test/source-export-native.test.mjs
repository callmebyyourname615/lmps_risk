import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { admin, availablePort, initializeServer, loadState, startServer, stopServer } from '../../../packages/source-preflight/scripts/local.mjs';

let scratch, state, config, client;
const script = fileURLToPath(new URL('../scripts/export_transfer.py', import.meta.url));
before(async () => {
  scratch = await mkdtemp('/tmp/lmps-export-native-');
  state = await initializeServer(join(scratch, 'db'), await availablePort());
  await startServer(state);
  client = join(state.runtime.base, 'bin/mariadb');
  config = join(scratch, 'client.cnf');
  await writeFile(config, '[client]\npassword=' + JSON.stringify(state.inspectorPassword) + '\n', { mode: 0o600, flag: 'wx' });
  const mapping = JSON.parse(await readFile(new URL('../../../docs/data-dictionary/source-mapping.json', import.meta.url), 'utf8'));
  const columns = [...mapping.source_tables.transfer.column_candidates,
    { name: 'fee', data_type: 'decimal', nullable: true }];
  const overrides = { id: 1, reference: 'SYNTHETIC_REFERENCE', frommember: '0001', tomember: '0002',
    amount: '9999999999999999999999.99', ccy: 'SYN', qrtype: 'ລາວ ไทย\t\n', fromchannel: 'SYNTHETIC_CHANNEL',
    fromaccount: '0001234', toaccount: '{"candidate":"SYNTHETIC_PRIVATE_ACCOUNT"}', fee: '0.10' };
  const connection = await admin(state);
  try {
    // Setup touches only this disposable synthetic fixture, never an operator's source.
    await connection.query('CREATE DATABASE lmps');
    await connection.query('CREATE TABLE lmps.transfer LIKE lmps_source_local.transfer');
    await connection.query('ALTER TABLE lmps.transfer ADD COLUMN fee DECIMAL(24,2) NULL');
    await connection.query('CREATE INDEX idx2_transfer ON lmps.transfer (requesttime)');
    await connection.query("GRANT SELECT ON lmps.transfer TO 'lmps_preflight'@'127.0.0.1'");
    const values = columns.map(column => {
      if (Object.hasOwn(overrides, column.name)) return overrides[column.name];
      if (column.nullable) return null;
      if (['int', 'tinyint', 'decimal'].includes(column.data_type)) return 0;
      if (column.data_type === 'datetime') return '2026-10-01 00:00:00';
      if (column.data_type === 'date') return '2026-10-01';
      return 'SYNTHETIC';
    });
    const insert = 'INSERT INTO lmps.transfer (' + columns.map(column => '`' + column.name + '`').join(',')
      + ') VALUES (' + columns.map(() => '?').join(',') + ')';
    await connection.query(insert, values);
    const background = Array.from({ length: 1000 }, (_, i) => columns.map((column, j) => {
      if (column.name === 'id') return i + 2;
      if (column.name === 'reference') return 'SYNTHETIC_BACKGROUND_' + i;
      if (column.data_type === 'datetime') return '2026-10-02 00:00:00';
      return values[j];
    }));
    await connection.batch(insert, background);
  } finally { await connection.end(); }
});
after(async () => {
  if (!state && scratch) {
    try { state = await loadState(join(scratch, 'db')); }
    catch { return; }
  }
  if (state) await stopServer(state);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('native client reproduces empty-init 1065; a SELECT-only startup probe succeeds', () => {
  const common = ['--defaults-file=' + config, '--host=127.0.0.1', '--port=' + state.port,
    '--user=lmps_preflight', '--ssl-ca=' + join(state.base, 'ca.crt'), '--ssl-verify-server-cert',
    '--skip-safe-updates', '--skip-reconnect', '--batch', '--skip-column-names', '--execute=SELECT 1'];
  const broken = spawnSync(client, [...common, '--init-command='], { encoding: 'utf8', timeout: 10000 });
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /ERROR 1065/);
  const fixed = spawnSync(client, [...common, '--init-command=SELECT 1'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(fixed.status, 0);
  assert.equal(fixed.stdout.trim(), '1');
});

test('production exporter reads the synthetic native fixture with SELECT grants and redacts native errors', () => {
  const code = String.raw`
import gzip, importlib.util, sys
from datetime import datetime, timedelta
from pathlib import Path
spec = importlib.util.spec_from_file_location("export_transfer", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
client, config, root, port, ca = sys.argv[2:]
connection = ["--host=127.0.0.1", "--port=" + port, "--user=lmps_preflight", "--ssl-ca=" + ca, "--ssl-verify-server-cert"]
start = datetime(2026, 10, 1)
good = Path(root) / "good"
bad = Path(root) / "bad"
good.mkdir(mode=0o700)
bad.mkdir(mode=0o700)
result = module.export_hour(client, connection, config, good, start, start + timedelta(hours=1))
assert result["rows"] == 1
data = gzip.decompress((good / result["file"]).read_bytes())
assert data.startswith(module.HEADER)
assert b"9999999999999999999999.99" in data
assert b"\t0001\t0002\t" in data
assert "ລາວ ไทย".encode() in data
assert data.count(b"\n") == 2
module.query = lambda start, end: "SELECT synthetic_missing FROM transfer"
try:
    module.export_hour(client, connection, config, bad, start, start + timedelta(hours=1))
except module.ExportError as error:
    assert str(error) == "MARIADB_SELECT_FAILED_ERROR_1054"
else:
    raise AssertionError("Native query failure was accepted")
assert not list(bad.glob("*.tsv.gz"))
print("PASS native SELECT-only export, exact money/Unicode and redacted error number")
`;
  const result = spawnSync('uv', ['run', '--locked', '--offline', '--all-packages', 'python', '-c', code,
    script, client, config, scratch, String(state.port), join(state.base, 'ca.crt')],
    { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, 'Native exporter check failed; underlying diagnostics withheld.');
  assert.match(result.stdout, /PASS native SELECT-only export/);
});

test('v2 pilot performs real metadata/range preflight, exports candidates and verifies its profile', () => {
  const code = String.raw`
import importlib.util, json, os, sys
from datetime import datetime
from pathlib import Path
spec = importlib.util.spec_from_file_location("export_transfer", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
client, config, root, port, ca = sys.argv[2:]
wrapper = Path(root) / "tls-client"
wrapper.write_text("#!" + sys.executable + "\nimport os,sys\nos.execv(" + repr(client)
                   + ", [" + repr(client) + "] + sys.argv[1:] + "
                   + repr(["--ssl-ca=" + ca, "--ssl-verify-server-cert"]) + ")\n")
wrapper.chmod(0o700)
password = json.loads(Path(config).read_text().split("password=", 1)[1])
mask = os.umask(0o077)
try:
    result = module.export_pilot(str(wrapper), "127.0.0.1", int(port), "lmps_preflight", password,
                                 datetime(2026, 10, 1), Path(root))
finally:
    os.umask(mask)
assert result == 0
bundle = next(Path(root).glob("lmps-export-pilot-v2-*"))
summary = module.verify_dataset(bundle)
assert summary["status"] == "pilot_complete"
assert summary["rows"] == 1
assert not summary["sample_truncated"]
profile = json.loads((bundle / "profile.json").read_text())
assert profile["account_identity"] == "unverified"
assert profile["account_field_shapes"]["fromaccount"]["ascii_digits"] == 1
assert profile["account_field_shapes"]["toaccount"]["json_object_or_array"] == 1
assert profile["fields"]["fee"]["null_rows"] == 0
assert "SYNTHETIC_PRIVATE_ACCOUNT" not in json.dumps(profile)
print("PASS native v2 pilot metadata/indexed range/22 fields/profile/verification")
`;
  const result = spawnSync('uv', ['run', '--locked', '--offline', '--all-packages', 'python', '-c', code,
    script, client, config, scratch, String(state.port), join(state.base, 'ca.crt')],
    { encoding: 'utf8', timeout: 20000 });
  const errorCode = result.stderr?.match(/ExportError: ([A-Z0-9_]+)/)?.[1]
    ?? result.stderr?.match(/\b([A-Za-z]+Error)(?::|$)/m)?.[1] ?? 'UNCLASSIFIED';
  assert.equal(result.status, 0, 'Native v2 pilot failed (' + errorCode + '); raw diagnostics withheld.');
  assert.match(result.stdout, /PASS native v2 pilot/);
});
