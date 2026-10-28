import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, GoneException } from '@nestjs/common';
import type { MonitoringReadSnapshot, MonitoringSession, MonitoringRecordsQuery, MonitoringRecordsPage, MonitoringRecord, MonitoringTrends } from '@lmps/contracts/monitoring';
import type { Principal } from './local-auth.js';
import { MonitoringReadError } from '@lmps/database';
import type { NetworkQuery } from '@lmps/contracts/monitoring-network';
import { selectMonitoringNetwork } from './monitoring-network.js';

const invalid = (): never => { throw new BadRequestException({ code: 'MONITORING_INVALID_QUERY', message: 'Invalid monitoring request.' }); };
const expired = (): never => { throw new GoneException({ code: 'MONITORING_SNAPSHOT_EXPIRED', message: 'This monitoring snapshot is unavailable. Refresh the overview.' }); };
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };
type Entry = { owner: string; payload: MonitoringReadSnapshot; session: MonitoringSession; bytes: number; deadline: number };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const amountCompare = (a: string, b: string) => {
  const [ai, af = ''] = a.split('.'), [bi, bf = ''] = b.split('.'), width = Math.max(af.length, bf.length);
  const x = BigInt(ai! + af.padEnd(width, '0')), y = BigInt(bi! + bf.padEnd(width, '0'));
  return x < y ? -1 : x > y ? 1 : 0;
};
/** Small local pilot cache. No PostgreSQL transaction or connection is held between requests. */
export class MonitoringSnapshots {
  private readonly entries = new Map<string, Entry>();
  private readonly secret = randomBytes(32);
  constructor(private readonly now = () => Date.now(), private readonly ttl = 300_000) {}
  private owner(principal: Principal) { return JSON.stringify([principal.workspace, principal.subject]); }
  private clean() { for (const [id, item] of this.entries) if (item.deadline <= this.now()) this.entries.delete(id); }
  create(principal: Principal, payload: MonitoringReadSnapshot): MonitoringSession {
    this.clean();
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    if (bytes > 8 * 1024 * 1024) throw new MonitoringReadError('MONITORING_SCOPE_TOO_LARGE');
    if (payload.summary.workspace_key !== principal.workspace) return invalid();
    const owner = this.owner(principal);
    // Eviction is explicit410 for an old tab, never a replacement with newer counts.
    const owned = [...this.entries].filter(([, item]) => item.owner === owner);
    while (owned.length >= 4) this.entries.delete(owned.shift()![0]);
    let used = [...this.entries.values()].reduce((sum, item) => sum + item.bytes, 0);
    while (this.entries.size && used + bytes > 32 * 1024 * 1024) {
      const id = this.entries.keys().next().value!, item = this.entries.get(id)!; used -= item.bytes; this.entries.delete(id);
    }
    const id = randomUUID(), deadline = this.now() + this.ttl;
    const session: MonitoringSession = { version: 'local-monitoring-records-1', snapshot_id: id, expires_at: new Date(deadline).toISOString(), summary: payload.summary };
    this.entries.set(id, { owner, payload: freeze(structuredClone(payload)), session: freeze(structuredClone(session)), bytes, deadline });
    return session;
  }
  private entry(principal: Principal, id: string): Entry {
    if (!UUID.test(id)) return invalid();
    this.clean(); const entry = this.entries.get(id);
    if (!entry || entry.owner !== this.owner(principal)) return expired();
    return entry;
  }
  session(principal: Principal, id: string) { return this.entry(principal, id).session; }
  trends(principal: Principal, id: string): MonitoringTrends {
    const { payload, session } = this.entry(principal, id);
    const result: MonitoringTrends = { ...session, version: 'local-monitoring-trends-1', rows: [...payload.transactions, ...payload.alerts] };
    if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new MonitoringReadError('MONITORING_SCOPE_TOO_LARGE');
    return result;
  }
  network(principal: Principal, id: string, query: NetworkQuery) {
    const entry = this.entry(principal, id);
    return selectMonitoringNetwork(entry.payload, entry.session, query);
  }
  evidence(principal: Principal, id: string, key: string) {
    const entry = this.entry(principal, id);
    if (!/^[A-Za-z0-9_-]{1,400}$/.test(key)) return invalid();
    const evidence = Object.hasOwn(entry.payload.evidence, key) ? entry.payload.evidence[key] : undefined;
    if (!evidence) return expired();
    return { ...entry.session, evidence };
  }
  page(principal: Principal, id: string, query: MonitoringRecordsQuery): MonitoringRecordsPage {
    const { session, payload } = this.entry(principal, id);
    const source = query.mode === 'alerts' ? payload.alerts : payload.transactions.filter(row => query.mode === 'transactions'
      || query.mode === 'assessed' && row.risk !== null || query.mode === 'not_assessed' && row.risk === null || query.mode === 'flagged' && !!row.risk?.patterns.length);
    const scopeTotal = source.length, rows = source.filter(row => !query.q || [row.transaction_id, row.namespace, row.alert_id ?? '', ...(row.alert?.patterns ?? row.risk?.patterns ?? [])].some(value => value.includes(query.q)));
    const identity = (row: MonitoringRecord) => JSON.stringify([row.namespace, row.transaction_id, row.alert_id ?? '']);
    const rank = (row: MonitoringRecord) => ['low', 'medium', 'high', 'critical'].indexOf(row.alert?.severity ?? row.risk?.severity ?? '');
    rows.sort((a, b) => {
      let order = 0;
      switch (query.sort) {
        case 'recorded_desc': order = compare(b.recorded_at, a.recorded_at); break;
        case 'recorded_asc': order = compare(a.recorded_at, b.recorded_at); break;
        case 'id_asc': order = compare(a.transaction_id, b.transaction_id); break;
        case 'id_desc': order = compare(b.transaction_id, a.transaction_id); break;
        case 'severity_desc': order = rank(b) - rank(a); break;
        case 'amount_asc': case 'amount_desc': order = compare(a.currency, b.currency) || amountCompare(a.amount, b.amount) * (query.sort === 'amount_desc' ? -1 : 1); break;
      }
      return order || compare(identity(a), identity(b));
    });
    const binding = JSON.stringify([id, query.mode, query.q, query.sort, query.limit]);
    const sign = (body: string) => createHmac('sha256', this.secret).update(binding).update(':').update(body).digest('base64url');
    const cursor = (offset: number) => { const body = Buffer.from(String(offset)).toString('base64url'); return body + '.' + sign(body); };
    let offset = 0;
    if (query.after) {
      const [body, signature, extra] = query.after.split('.'), expected = sign(body!);
      if (extra !== undefined || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return invalid();
      const raw = Buffer.from(body!, 'base64url').toString('utf8'); if (!/^[1-9][0-9]{0,3}$/.test(raw)) return invalid();
      offset = Number(raw); if (offset % query.limit || offset >= rows.length) return invalid();
    }
    return { ...session, query, total: rows.length, scope_total: scopeTotal, page: offset / query.limit + 1, rows: rows.slice(offset, offset + query.limit),
      next_cursor: offset + query.limit < rows.length ? cursor(offset + query.limit) : null,
      previous_cursor: offset > query.limit ? cursor(offset - query.limit) : null };
  }
}
