/** Pure bounded oracle. Positions identify observations, never business identity.
 * No cross-system exactly-once claim. Concurrent snapshot writes/DDL/expired logs untested. */
import { createHash } from 'node:crypto';
export const LIMITS = Object.freeze({ records: 2000, bytes: 2 * 1024 ** 2, recordBytes: 32768, storage: 2 * 1024 ** 3, free: 6 * 1024 ** 3, trialMs: 180000 });
export const FIXTURE = Object.freeze({ database: 'lmps_cdc_invented', table: 'specimens', topic: 'lmps_cdc.lmps_cdc_invented.specimens' });
export function fault(code = 'INVALID_OBSERVATION') { return Object.assign(new Error(code), { code }); }
function check(condition, code) { if (!condition) throw fault(code); }
function object(value, allowed, required = allowed) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value, k)));
}
const integer = n => Number.isSafeInteger(n) && n >= 0;
// Nanosecond metadata may exceed JS safe integers; never use it for ordering,
// observation identity or money. Exact file/row/offset positions stay safe.
const timestamp = n => Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 9e18;
function row(value) {
  object(value, ['id', 'revision', 'amount', 'currency']);
  check(Number.isInteger(value.id) && value.id > 0 && value.id <= 4 && Number.isInteger(value.revision) && value.revision > 0 && value.revision <= 3);
  if (value.amount === '__debezium_unavailable_value') throw fault('UNAVAILABLE_VALUE');
  check(typeof value.amount === 'string' && /^(0|[1-9][0-9]{0,19})\.[0-9]{4}$/.test(value.amount));
  check(value.currency === 'XTS');
  return { id: value.id, revision: value.revision, amount: value.amount, currency: value.currency };
}
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Transport-neutral schema-less JSON input. A null value means tombstone. */
export function parseObservation(record) {
  check(Buffer.byteLength(JSON.stringify(record) ?? '') <= LIMITS.recordBytes, 'RECORD_LIMIT');
  object(record, ['topic', 'partition', 'offset', 'key', 'value']);
  check(record.topic === FIXTURE.topic && record.partition === 0 && integer(record.offset));
  object(record.key, ['id']); check(Number.isInteger(record.key.id) && record.key.id > 0 && record.key.id <= 4);
  if (record.value === null) return { ...record, op: 't', id: record.key.id, signature: digest(record) };
  const v = record.value;
  object(v, ['before', 'after', 'source', 'op', 'ts_ms', 'ts_us', 'ts_ns', 'transaction'], ['before', 'after', 'source', 'op']);
  check(['r', 'c', 'u', 'd'].includes(v.op), 'UNSUPPORTED_OPERATION');
  for (const field of ['ts_ms', 'ts_us', 'ts_ns']) if (v[field] !== undefined) check(v[field] === null || timestamp(v[field]));
  check(v.transaction === undefined || v.transaction === null, 'UNSUPPORTED_TRANSACTION');
  const s = v.source;
  object(s, ['version', 'connector', 'name', 'ts_ms', 'ts_us', 'ts_ns', 'snapshot', 'db', 'sequence', 'table', 'server_id', 'gtid', 'file', 'pos', 'row', 'thread', 'query'], ['connector', 'name', 'snapshot', 'db', 'table', 'file', 'pos', 'row']);
  check(s.connector === 'mariadb' && s.name === 'lmps_cdc' && s.db === FIXTURE.database && s.table === FIXTURE.table);
  check(typeof s.file === 'string' && /^local-bin\.[0-9]{6}$/.test(s.file) && integer(s.pos) && integer(s.row));
  check(['first', 'true', 'last', 'false', true, false].includes(s.snapshot));
  check(v.op === 'r' ? ['first', 'true', 'last', true].includes(s.snapshot) : ['false', false].includes(s.snapshot));
  for (const val of Object.values(s)) check(val === null || ['string', 'number', 'boolean'].includes(typeof val) && String(val).length <= 256);
  for (const val of Object.values(s)) if (typeof val === 'number') check(timestamp(val));
  check(s.query === undefined || s.query === null, 'UNSUPPORTED_QUERY');
  const before = v.before === null ? null : row(v.before), after = v.after === null ? null : row(v.after);
  check(v.op === 'd' ? before && !after : after && (v.op === 'u' ? before : !before));
  check((after ?? before).id === record.key.id && (!before || before.id === record.key.id));
  return { ...record, op: v.op, id: record.key.id, before, after, snapshotFirst: s.snapshot === 'first', snapshotLast: s.snapshot === 'last', position: `${v.op}:${s.file}:${s.pos}:${s.row}:${record.key.id}`, signature: digest(record) };
}
const a = (id, revision, amount) => ({ id, revision, amount, currency: 'XTS' });
// Declared independently of observed transport/reducer state.
const expected = {
  snapshot: { operations: ['r:1:1', 'r:2:1'], rows: [a(1, 1, '9007199254740993.1200'), a(2, 1, '0.0100')], tombstones: 0, count: 2 },
  stream: { operations: ['r:1:1', 'r:2:1', 'c:3:1', 'u:1:2', 'd:2:1'], rows: [a(1, 2, '9007199254740993.1201'), a(3, 1, '12.3400')], tombstones: 1, count: 6 },
  restart: { operations: ['r:1:1', 'r:2:1', 'c:3:1', 'u:1:2', 'd:2:1', 'u:3:2', 'c:4:1'], rows: [a(1, 2, '9007199254740993.1201'), a(3, 2, '12.3401'), a(4, 1, '1.0000')], tombstones: 1, count: 8 }
};
export function expectedPhase(phase) { check(Object.hasOwn(expected, phase)); return structuredClone(expected[phase]); }
export function createOracle() {
  const offsets = new Map(), positions = new Set(), rows = new Map(), operations = new Set();
  let bytes = 0, count = 0, lastOffset = -1, snapshotComplete = false, streaming = false, pendingDelete = null, tombstones = 0;
  return {
    accept(record) {
      bytes += Buffer.byteLength(JSON.stringify(record) ?? ''); count++;
      check(count <= LIMITS.records && bytes <= LIMITS.bytes, 'CAPTURE_LIMIT');
      const o = parseObservation(record), key = `${o.partition}:${o.offset}`;
      if (offsets.has(key)) { check(offsets.get(key) === o.signature, 'IDENTITY_CONFLICT'); return; }
      check(o.offset === lastOffset + 1, 'OFFSET_ORDER');
      if (o.position && positions.has(o.position)) throw fault('POSITION_REUSE');
      if (pendingDelete !== null) check(o.op === 't' && o.id === pendingDelete, 'MISSING_TOMBSTONE');
      if (o.op === 't') { check(pendingDelete === o.id, 'UNEXPECTED_TOMBSTONE'); tombstones++; pendingDelete = null; }
      else {
        if (o.snapshotFirst) check(lastOffset === -1 && rows.size === 0, 'SNAPSHOT_ORDER');
        if (o.op === 'r') check(!streaming && !snapshotComplete && !rows.has(o.id), 'SNAPSHOT_ORDER');
        else { check(snapshotComplete, 'MISSING_SNAPSHOT'); streaming = true; }
        const prior = rows.get(o.id);
        if (['r', 'c'].includes(o.op)) check(!prior && o.after.revision === 1, 'ROW_ORDER');
        else {
          check(prior && JSON.stringify(prior) === JSON.stringify(o.before), 'BEFORE_MISMATCH');
          if (o.op === 'u') check(o.after.revision === prior.revision + 1, 'REVISION_ORDER');
        }
        if (o.op === 'd') { rows.delete(o.id); pendingDelete = o.id; }
        else rows.set(o.id, o.after);
        const operation = `${o.op}:${o.id}:${(o.after ?? o.before).revision}`;
        check(!operations.has(operation), 'OPERATION_REUSE'); operations.add(operation);
        if (o.snapshotLast) snapshotComplete = true;
        positions.add(o.position);
      }
      offsets.set(key, o.signature); lastOffset = o.offset;
    },
    verify(phase) {
      const e = expectedPhase(phase), actualRows = [...rows.values()].sort((x, y) => x.id - y.id);
      check(snapshotComplete && pendingDelete === null && offsets.size === e.count && tombstones === e.tombstones && JSON.stringify([...operations].sort()) === JSON.stringify(e.operations.sort()) && JSON.stringify(actualRows) === JSON.stringify(e.rows), 'EXPECTED_MISMATCH');
      return Object.freeze({ records: offsets.size, observations: count, bytes, tombstones, stateSha256: digest(actualRows), operationsSha256: digest([...operations].sort()) });
    }
  };
}
