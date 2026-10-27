import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { admin, loadState, localMode } from '../../packages/source-preflight/scripts/local.mjs';

export const FIXTURE = {
  transfer: [
    { id: 1, requesttime: '2026-01-01 00:00:00', amount: '123.45', ccy: 'RAW_CCY', result: null },
    { id: 1, requesttime: '2026-01-02 00:00:00', amount: '9999999999999999999999.99', ccy: 'RAW_CCY', result: 'RAW_RESULT' },
    { id: 2, requesttime: '2026-01-01 00:00:00', amount: '-1.00', ccy: 'RAW_OTHER', result: '' },
  ],
  transfer_hist: [{ id: 1, requesttime: '2026-01-01 00:00:00', amount: '123.45', ccy: 'RAW_CCY', result: 'HISTORY_ONLY' }],
  transfer_old: [{ id: 1, requesttime: '2026-01-01 00:00:00', amount: '0.00', ccy: 'RAW_CCY', result: null }],
  member: [{ code: 'SYNTHETIC_A', iin: 'TEST_A', status: null, member_type: 'synthetic' }, { code: 'SYNTHETIC_B', iin: 'TEST_B', status: '', member_type: null }],
};
export const COLUMNS = {
  transfer: 'id,requesttime,amount,ccy,result,txtime',
  transfer_hist: 'id,requesttime,amount,ccy,result,txtime',
  transfer_old: 'id,amount,ccy,result,txtime',
  member: 'code,status,member_type',
};

export function readerConfig(state) {
  if (!state.snapshotPassword || !state.snapshotGeneration || !state.ready) throw new Error('Local snapshot reader is not prepared.');
  return { kind: 'local_synthetic', host: '127.0.0.1', port: state.port, database: 'lmps_source_local', user: 'lmps_snapshot', password: state.snapshotPassword, caFile: join(state.base, 'ca.crt'), sourceGeneration: state.snapshotGeneration };
}

export async function prepareSnapshotFixture(state) {
  localMode();
  const connection = await admin(state);
  try {
    const users = await connection.query("SELECT User FROM mysql.global_priv WHERE User='lmps_snapshot'");
    if (users.length && !state.snapshotPassword) throw new Error('Refusing an unowned snapshot role.');
    if (!state.snapshotPassword) {
      state.snapshotPassword = randomBytes(24).toString('base64url');
      state.snapshotGeneration = randomUUID();
      await writeFile(join(state.base, 'state.json'), JSON.stringify(state), { mode: 0o600 });
    }
    if (!users.length) await connection.query(`CREATE USER 'lmps_snapshot'@'127.0.0.1' IDENTIFIED BY '${state.snapshotPassword}' REQUIRE SSL`);
    for (const [table, columns] of Object.entries(COLUMNS)) await connection.query(`GRANT SELECT (${columns}) ON lmps_source_local.\`${table}\` TO 'lmps_snapshot'@'127.0.0.1'`);
    await connection.query('START TRANSACTION');
    for (const [table, rows] of Object.entries(FIXTURE)) {
      const count = (await connection.query(`SELECT count(*) AS n FROM lmps_source_local.\`${table}\``))[0].n;
      if (count !== 0n && count !== BigInt(rows.length)) throw new Error('Fixture table is populated; refusing to overwrite.');
      for (const [index, value] of rows.entries()) {
        const row = table === 'member' ? value : {
          ...value, txtime: value.requesttime, reference: `SYNTHETIC_${table}_${index}`,
          frommember: 'SYNTHETIC_A', tomember: 'SYNTHETIC_B', fromaccount: 'SYNTHETIC_NOT_AN_ACCOUNT', toaccount: 'SYNTHETIC_NOT_AN_ACCOUNT',
          totype: 'synthetic', isreconciled: 0, issettled: 0,
        };
        if (count === 0n) await connection.query(`INSERT INTO lmps_source_local.\`${table}\` (${Object.keys(row).map(name => '`' + name + '`').join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, Object.values(row));
        else {
          const matches = await connection.query(`SELECT 1 FROM lmps_source_local.\`${table}\` WHERE ${Object.keys(row).map(name => '`' + name + '` <=> ?').join(' AND ')} LIMIT 1`, Object.values(row));
          if (matches.length !== 1) throw new Error('Fixture changed; refusing to overwrite.');
        }
      }
    }
    await connection.query('COMMIT');
    return readerConfig(state);
  } catch { await connection.query('ROLLBACK').catch(() => {}); throw new Error('Synthetic fixture preparation failed; details withheld.'); }
  finally { await connection.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await prepareSnapshotFixture(await loadState());
    console.info('Local synthetic snapshot fixture ready: 7 rows; existing matching rows preserved.');
  } catch { console.error('Local fixture preparation failed; diagnostics withheld.'); process.exitCode = 1; }
}
