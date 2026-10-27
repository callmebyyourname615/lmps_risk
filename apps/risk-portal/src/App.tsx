import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortalClient, PortalError, tokenIdentity, UUID, type AlertDetail, type AlertReviewCommand, type AlertSummary, type Catalog, type Identity, type InboxQuery, type Locale, type PortalClient } from './client.ts';
import { copy, errorText, type CopyKey } from './copy.ts';
import { connectPreview, isLocalPreview } from './preview-session.ts';
import { RiskOverview } from './RiskOverview.tsx';

type Session = { client: PortalClient; identity: Identity; catalog: Catalog; id: number };
type Route = { page: 'overview' | 'inbox' | 'definitions' | 'detail' | 'missing'; id?: string };
const errorCode = (e: unknown) => e instanceof PortalError ? e.code : 'PORTAL_NETWORK';
const route = (): Route => {
  const hash = globalThis.location?.hash ?? '';
  if (!hash || hash === '#/overview') return { page: 'overview' };
  if (hash === '#/definitions') return { page: 'definitions' };
  if (hash.startsWith('#/alerts/')) { const id = hash.slice(9); return UUID.test(id) ? { page: 'detail', id } : { page: 'missing' }; }
  return { page: 'inbox' };
};
const time = (value: string | number, locale: Locale) => new Intl.DateTimeFormat(locale === 'lo' ? 'lo-LA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
const number = (value: number | null) => value === null ? '—' : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
const dimensions = ['fraud_score', 'mule_network_score', 'aml_suspicion_score'] as const;
const dimensionLabels = ['fraud', 'mule_network', 'aml'] as const;

function useRemote<T>(load: (signal: AbortSignal) => Promise<T>, key: string, unauthorized: () => void, keep = true) {
  const [data, setData] = useState<T>(), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(true), [revision, setRevision] = useState(0);
  const current = useRef({ load, unauthorized }); current.current = { load, unauthorized };
  useEffect(() => {
    let valid = true; const controller = new AbortController(); setBusy(true); setError(null); if (!keep) setData(undefined);
    current.current.load(controller.signal).then(value => { if (valid) setData(value); }).catch(e => {
      if (!valid) return; const code = errorCode(e); if (code === 'UNAUTHORIZED') current.current.unauthorized(); else { if (code === 'FORBIDDEN') setData(undefined); setError(code); }
    }).finally(() => { if (valid) setBusy(false); });
    return () => { valid = false; controller.abort(); };
  }, [key, revision, keep]);
  return { data, error, busy, stale: error !== null && data != null,
    reload: () => setRevision(v => v + 1), update: (value: T) => { setData(value); setError(null); } };
}
export function Notice({ title, children, tone = 'warning' }: { title?: string; children?: ReactNode; tone?: string }) {
  return <div className={'notice notice-' + tone} role={tone === 'error' ? 'alert' : 'status'}>{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div>;
}
function Language({ locale, onChange }: { locale: Locale; onChange: (l: Locale) => void }) {
  return <div className="language" role="group" aria-label="Language / ພາສາ">
    <button lang="lo" aria-pressed={locale === 'lo'} onClick={() => onChange('lo')}>ລາວ</button>
    <button lang="en" aria-pressed={locale === 'en'} onClick={() => onChange('en')}>EN</button>
  </div>;
}
export function Score({ item, locale, compact = false }: { item: AlertSummary; locale: Locale; compact?: boolean }) {
  const c = copy(locale);
  return <div className={compact ? 'indices indices-compact' : 'indices'}>{dimensions.map((key, i) => {
    const score = item[key], label = c[dimensionLabels[i]!];
    return <div className="index" key={key} data-level={score.severity ?? 'unavailable'}>
      <span className="index-name">{label}</span><strong className="index-number">{number(score.value)}</strong>
      {score.value !== null ? <meter aria-label={label + ' ' + number(score.value)} min={0} max={1} value={score.value} /> : <span className="unavailable-line" />}
      {!compact && <><span className="index-caption">{score.value === null ? c[score.status as CopyKey] ?? c.unavailable : c.available}</span>
        <span className="coverage">{c.evaluated} {score.coverage.evaluated}/{score.coverage.configured}<br />{c.unknownInputs} {score.coverage.unavailable}</span></>}
    </div>;
  })}</div>;
}
export function App() {
  const [locale, setLocale] = useState<Locale>('lo'), [session, setSession] = useState<Session | null>(null), [currentRoute, setRoute] = useState(route), [loginError, setLoginError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null); sessionRef.current = session;
  const [preview] = useState(() => isLocalPreview(location.hostname, document.querySelector('meta[name="lmps-local-preview"]')?.getAttribute('content') ?? null));
  const [previewConnecting, setPreviewConnecting] = useState(preview), [previewFailure, setPreviewFailure] = useState<string | null>(null);
  const localeRef = useRef(locale); localeRef.current = locale;
  const previewActive = useRef(true), previewRequest = useRef<AbortController | null>(null), previewPending = useRef(false);
  const renewPreview = useCallback(async () => {
    if (!preview || previewPending.current) return;
    previewPending.current = true; setPreviewConnecting(true);
    const controller = new AbortController(); previewRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const next = await connectPreview(localeRef.current, controller.signal);
      if (!previewActive.current) { next.client.close(); return; }
      const previous = sessionRef.current;
      if (previous) {
        try { previous.client.renewToken(next.token); } finally { next.client.close(); }
        const updated = { ...previous, identity: next.identity, catalog: next.catalog };
        sessionRef.current = updated; setSession(updated);
      } else {
        const created = { client: next.client, identity: next.identity, catalog: next.catalog, id: Date.now() };
        sessionRef.current = created; setSession(created);
      }
      setPreviewFailure(null);
    } catch (error) { if (previewActive.current) setPreviewFailure(errorCode(error)); }
    finally { clearTimeout(timeout); previewPending.current = false; if (previewActive.current) setPreviewConnecting(false); }
  }, [preview]);
  useEffect(() => () => { previewActive.current = false; previewRequest.current?.abort(); }, []);
  useEffect(() => {
    if (!preview) return;
    if (!session) { if (!previewFailure) void renewPreview(); return; }
    const remaining = session.identity.expires - Date.now();
    const delay = previewFailure ? 10000 : Math.max(0, remaining - Math.min(30000, Math.max(1000, remaining / 2)));
    const timer = setTimeout(() => void renewPreview(), delay);
    return () => clearTimeout(timer);
  }, [preview, session, previewFailure, renewPreview]);
  const c = copy(locale);
  const logout = useCallback((expired = false) => {
    sessionRef.current?.client.close(); setSession(null); setLoginError(expired ? 'UNAUTHORIZED' : null);
    history.replaceState(null, '', location.pathname); setRoute({ page: 'overview' });
  }, []);
  useEffect(() => {
    const changed = () => setRoute(route()); addEventListener('hashchange', changed);
    return () => { removeEventListener('hashchange', changed); sessionRef.current?.client.close(); };
  }, []);
  useEffect(() => { document.documentElement.lang = locale; document.title = 'LMPS · ' + c.desk; }, [locale, c.desk]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => { if (preview) void renewPreview(); else logout(true); }, Math.max(0, session.identity.expires - Date.now())); return () => clearTimeout(timer);
  }, [session, logout, preview, renewPreview]);
  return <div className="app" lang={locale}>
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus(); }}>{c.skip}</a>
    <aside className="sidebar">
      <a className="brand" href="#/overview" aria-label="LMPS"><span className="brand-symbol" aria-hidden="true">L<span /></span><span>LMPS<small>ANALYST DESK</small></span></a>
      <p className="sidebar-title">{c.workspace}</p>
      <nav aria-label={c.workspace}>
        <a href="#/overview" aria-current={currentRoute.page === 'overview' ? 'page' : undefined}><span aria-hidden="true">◫</span>{c.overview}</a>
        <a href="#/" aria-current={currentRoute.page === 'inbox' || currentRoute.page === 'detail' ? 'page' : undefined}><span aria-hidden="true">▤</span>{c.alerts}</a>
        <a href="#/definitions" aria-current={currentRoute.page === 'definitions' ? 'page' : undefined}><span aria-hidden="true">⊞</span>{c.definitions}</a>
      </nav>
      <div className="sidebar-bottom"><span className="workspace-dot" />{c.local}<small>{c.synthetic}</small><code>LMPS / ANALYST DESK</code></div>
    </aside>
    <div className="workspace">
      <header className="topbar portal-header">
        <span className="eyebrow">{c.desk}</span>
        <div className="top-actions"><span className="environment-pill">{c.synthetic}</span><Language locale={locale} onChange={setLocale} />{session && !preview && <button className="text-button signout" onClick={() => logout()}>{c.signOut}</button>}</div>
      </header>
      <main id="main" tabIndex={-1}>
        {preview && (previewConnecting || previewFailure) && <div className="preview-connection" role={previewFailure ? 'alert' : 'status'}>
          {previewFailure ? <>{errorText(previewFailure, locale)} <button className="button secondary" disabled={previewConnecting} onClick={() => void renewPreview()}>{c.refresh}</button></> : c.connecting}
        </div>}
        {!session ? (preview ? null : <Login locale={locale} error={loginError} onConnect={value => { setLoginError(null); setSession({ ...value, id: Date.now() }); }} />)
          : <div inert={preview && (previewConnecting || !!previewFailure) ? true : undefined}><Workspace key={session.id} session={session} locale={locale} currentRoute={currentRoute} preview={preview} unauthorized={preview ? () => void renewPreview() : () => logout(true)} /></div>}

      </main>
      <footer>{c.noDecision}<span>LMPS / ANALYST DESK</span></footer>
    </div>
  </div>;
}
function Login({ locale, error, onConnect }: { locale: Locale; error: string | null; onConnect: (value: Omit<Session, 'id'>) => void }) {
  const c = copy(locale), input = useRef<HTMLInputElement>(null), mounted = useRef(true), attempt = useRef(0), pendingClient = useRef<PortalClient | null>(null);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<string | null>(null);
  useEffect(() => () => { mounted.current = false; pendingClient.current?.close(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !input.current) return; const raw = input.current.value; input.current.value = ''; const id = ++attempt.current;
    setBusy(true); setFailure(null);
    try {
      const parsed = tokenIdentity(raw), client = createPortalClient(parsed.token); pendingClient.current = client;
      const catalog = await client.catalog(locale);
      if (!mounted.current || id !== attempt.current) { client.close(); return; }
      if (parsed.identity.expires <= Date.now()) throw new PortalError('UNAUTHORIZED', 401);
      pendingClient.current = null; onConnect({ client, identity: parsed.identity, catalog });
    } catch (e) { pendingClient.current?.close(); pendingClient.current = null; if (mounted.current) setFailure(errorCode(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="login-layout">
    <div className="login-editorial"><span className="eyebrow">LMPS / {c.desk}</span><h1>{c.connectTitle}</h1><p className="intro">{c.connectIntro}</p>
      <div className="login-rule"><span>01</span><p>{c.findings}</p></div><div className="login-rule"><span>02</span><p>{c.evidence}</p></div><div className="login-rule"><span>03</span><p>{c.history}</p></div></div>
    <form className="login-form" onSubmit={submit} aria-busy={busy} autoComplete="off"><span className="eyebrow">{c.local}</span><h2>{c.connect}</h2>
      {(failure || error) && <Notice tone="error">{errorText(failure ?? error!, locale)}</Notice>}
      <label htmlFor="access-token">{c.accessToken}</label><input ref={input} id="access-token" type="password" required maxLength={4096} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="token-help" disabled={busy} />
      <p id="token-help" className="help">{c.tokenHelp}</p><button className="button primary" type="submit" disabled={busy}>{busy ? c.connecting : c.connect}<span aria-hidden="true">↗</span></button>
    </form>
  </section>;
}
function Workspace({ session, locale, currentRoute, preview = false, unauthorized }: { session: Session; locale: Locale; currentRoute: Route; preview?: boolean; unauthorized: () => void }) {
  const c = copy(locale);
  const remote = useRemote(signal => session.catalog.locale === locale ? Promise.resolve(session.catalog) : session.client.catalog(locale, signal), session.id + ':' + session.identity.expires + ':' + locale, unauthorized);
  const catalog = remote.data?.locale === locale ? remote.data : undefined;
  return <><div className="session-strip"><span className="access-dot" />{session.identity.canReview ? c.reviewAccess : c.readOnly}<span className="session-identity">{session.identity.subject}</span><span>{preview ? c.localPreview : <>{c.expires} {time(session.identity.expires, locale)}</>}</span></div>
    {remote.error && <Notice tone="error">{errorText(remote.error, locale)} <button className="text-button" onClick={remote.reload}>{c.refresh}</button></Notice>}
    {currentRoute.page === 'overview' && <OverviewPage session={session} locale={locale} catalog={catalog} unauthorized={unauthorized} />}
    {currentRoute.page === 'inbox' && <Inbox session={session} locale={locale} catalog={catalog} unauthorized={unauthorized} />}
    {currentRoute.page === 'detail' && <Detail key={currentRoute.id} id={currentRoute.id!} session={session} locale={locale} catalog={catalog} unauthorized={unauthorized} />}
    {currentRoute.page === 'definitions' && <><PageTitle eyebrow={c.definitions} title={c.definitionsTitle} intro={c.definitionsIntro} />{!catalog ? <Loading label={c.loadingCatalog} /> : <div className="definition-grid">{catalog.risk_types.map(r => <article className="definition" data-dimension={r.dimension} key={r.code}><code>{r.code}</code><h2>{r.title}</h2><p>{r.definition}</p><h3>{c.condition}</h3><p>{r.condition}</p><h3>{c.limitation}</h3><p className="muted">{r.limitation}</p></article>)}</div>}</>}
    {currentRoute.page === 'missing' && <Notice title={c.missingTitle}>{c.missingBody}</Notice>}
  </>;
}
function PageTitle({ eyebrow, title, intro, action }: { eyebrow: string; title: string; intro?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{intro && <p className="intro">{intro}</p>}</div>{action}</div>;
}
function Loading({ label }: { label: string }) { return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label}</div>; }
function OverviewPage({ session, locale, catalog, unauthorized }: { session: Session; locale: Locale; catalog?: Catalog; unauthorized: () => void }) {
  const c = copy(locale);
  const remote = useRemote(signal => session.client.inbox({}, locale, signal), session.id + ':overview:' + session.identity.expires + ':' + locale, unauthorized, false);
  return <><PageTitle eyebrow={c.overview} title={c.overviewTitle} intro={c.overviewIntro} action={<button className="button secondary" onClick={remote.reload} disabled={remote.busy}>{remote.busy ? c.refreshing : c.refresh}<span aria-hidden="true">↻</span></button>} />
    {remote.error && <Notice tone="error">{errorText(remote.error, locale)} <button className="text-button" onClick={remote.reload}>{c.refresh}</button></Notice>}
    {remote.busy && <Loading label={c.loading} />}
    {!remote.busy && !remote.error && remote.data && <RiskOverview items={remote.data.items} catalog={catalog} locale={locale} />}
  </>;
}
function Inbox({ session, locale, catalog, unauthorized }: { session: Session; locale: Locale; catalog?: Catalog; unauthorized: () => void }) {
  const c = copy(locale), [filters, setFilters] = useState<InboxQuery>({}), [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const query = { ...filters, after: cursors.at(-1) }, key = JSON.stringify(query) + locale + session.identity.expires;
  const remote = useRemote(signal => session.client.inbox(query, locale, signal), key, unauthorized, false);
  const change = (name: keyof InboxQuery, value: string) => { setFilters(old => ({ ...old, [name]: value || undefined })); setCursors([undefined]); };
  return <><PageTitle eyebrow={c.alerts} title={c.inboxTitle} intro={c.inboxIntro} action={<button className="button secondary" onClick={remote.reload} disabled={remote.busy}>{remote.busy ? c.refreshing : c.refresh}<span aria-hidden="true">↻</span></button>} />
    <div className="queue-caption"><strong>{remote.data ? String(remote.data.items.length).padStart(2, '0') : '—'}</strong><span>{c.loaded}</span><p>{c.liveList}</p></div>
    <div className="filters">
      <div className="filter-field"><label htmlFor="filter-state">{c.state}</label><select id="filter-state" value={filters.state ?? ''} onChange={e => change('state', e.target.value)}><option value="">{c.allStates}</option>{['open', 'acknowledged', 'reviewed'].map(v => <option key={v} value={v}>{c[v as CopyKey]}</option>)}</select></div>
      <div className="filter-field"><label htmlFor="filter-severity">{c.severity}</label><select id="filter-severity" value={filters.severity ?? ''} onChange={e => change('severity', e.target.value)}><option value="">{c.allSeverities}</option>{['low', 'medium', 'high', 'critical'].map(v => <option key={v} value={v}>{c[v as CopyKey]}</option>)}</select></div>
      <div className="filter-field risk-filter"><label htmlFor="filter-risk">{c.riskType}</label><select id="filter-risk" value={filters.risk_code ?? ''} onChange={e => change('risk_code', e.target.value)} disabled={!catalog}><option value="">{c.allRisks}</option>{catalog?.risk_types.map(v => <option key={v.code} value={v.code}>{v.title}</option>)}</select></div>
      <button className="text-button" onClick={() => { setFilters({}); setCursors([undefined]); }}>{c.clearFilters}</button>
    </div>
    {remote.error && <Notice tone="error">{errorText(remote.error, locale)} <button className="text-button" onClick={remote.reload}>{c.refresh}</button></Notice>}
    <div aria-busy={remote.busy}>{remote.busy && <Loading label={c.loading} />}
      {!remote.busy && remote.data?.items.length === 0 && <div className="empty"><span aria-hidden="true">⌑</span><h2>{c.emptyTitle}</h2><p>{c.emptyBody}</p></div>}
      {!!remote.data?.items.length && <div className="table-wrap"><table><caption className="sr-only">{c.alerts}</caption><thead><tr><th>{c.alert} / {c.transaction}</th><th>{c.signals}</th><th>{c.indices}</th><th>{c.severity}</th><th>{c.state}</th><th className="sr-only">{c.detail}</th></tr></thead>
        <tbody>{remote.data.items.map(item => <tr key={item.alert_id}><td><a className="alert-link" href={'#/alerts/' + item.alert_id}>{item.target.transaction_id}<span aria-hidden="true">↗</span></a><small className="mono">{item.alert_id.slice(0, 8)} · {c.revision} {item.target.revision_number}</small><small>{time(item.created_at, locale)}</small></td>
          <td><div className="signal-tags">{item.selected_risk_types.slice(0, 2).map(code => <span key={code}>{catalog?.risk_types.find(r => r.code === code)?.title ?? code}</span>)}{item.selected_risk_types.length > 2 && <span className="more-signals">+{item.selected_risk_types.length - 2}</span>}</div>{item.assessment_status === 'partial' && <small className="partial-label">{c.partial}</small>}</td>
          <td><Score compact item={item} locale={locale} /></td><td><span className={'severity severity-' + item.severity}>{c[item.severity]}</span></td><td><span className={'state state-' + item.state}>{c[item.state]}</span></td><td><a href={'#/alerts/' + item.alert_id} className="row-arrow" aria-label={c.detail + ' ' + item.target.transaction_id}>↗</a></td></tr>)}</tbody></table></div>}
    </div>
    <div className="pagination"><p>{c.page} <strong>{cursors.length}</strong><span>{c.indexMeaning}</span></p><div><button className="button secondary" disabled={remote.busy || cursors.length === 1} onClick={() => setCursors(v => v.slice(0, -1))}>← {c.previous}</button><button className="button secondary" disabled={remote.busy || !remote.data?.next_cursor} onClick={() => { if (remote.data?.next_cursor) setCursors(v => [...v, remote.data!.next_cursor!]); }}>{c.next} →</button></div></div>
  </>;
}
function Detail({ id, session, locale, catalog, unauthorized }: { id: string; session: Session; locale: Locale; catalog?: Catalog; unauthorized: () => void }) {
  const c = copy(locale), remote = useRemote(signal => session.client.detail(id, locale, signal), id + locale + session.identity.expires, unauthorized);
  const [onlySelected, setOnlySelected] = useState(false), [outcome, setOutcome] = useState(''), [note, setNote] = useState(''), [pending, setPending] = useState<AlertReviewCommand | null>(null);
  const [saving, setSaving] = useState(false), [conflict, setConflict] = useState(false), [saveError, setSaveError] = useState<string | null>(null), [success, setSuccess] = useState<string | null>(null);
  const localeRef = useRef(locale); localeRef.current = locale;
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);
  const view = remote.data, fresh = !!view && !remote.busy && !remote.error && !!catalog && !conflict;
  function reload() { if (saving) return; setPending(null); setConflict(false); setSaveError(null); setSuccess(null); remote.reload(); }
  async function submit(command?: AlertReviewCommand) {
    if (!view || saving || (!command && (!fresh || pending || !session.identity.canReview))) return;
    const actual = command ?? { request_id: crypto.randomUUID(), expected_version: view.version, action: view.state === 'open' ? 'acknowledge' : 'review', outcome: view.state === 'open' ? null : outcome as AlertReviewCommand['outcome'], note: view.state === 'open' ? null : note };
    setSaving(true); setPending(actual); setSaveError(null); setSuccess(null);
    try {
      const result = await session.client.review(id, actual, locale);
      if (!alive.current) return; setPending(null); setNote(''); setOutcome(''); setSuccess(result.status === 'duplicate' ? 'duplicate' : 'saved');
      if (localeRef.current === locale) remote.update(result.alert); else remote.reload();
    } catch (e) {
      if (!alive.current) return; const code = errorCode(e);
      if (code === 'UNAUTHORIZED') { unauthorized(); return; }
      setSaveError(code);
      if (code === 'ALERT_REVIEW_CONFLICT') { setConflict(true); setPending(null); }
      else if (e instanceof PortalError && e.status >= 400 && e.status < 500) setPending(null);
      // An uncertain write retains its exact request ID/content until retry or an explicit reload.
    } finally { if (alive.current) setSaving(false); }
  }
  return <><a className="back-link" href="#/">← {c.back}</a>
    <PageTitle eyebrow={c.detail} title={view?.target.transaction_id ?? c.loading} action={<button className="button secondary" disabled={saving || remote.busy} onClick={reload}>{c.reload}<span aria-hidden="true">↻</span></button>} />
    {remote.error && <Notice tone="error" title={remote.stale ? c.staleTitle : undefined}>{errorText(remote.error, locale)}{remote.stale && <p>{c.staleBody}</p>}</Notice>}
    {remote.busy && <Loading label={c.loading} />}
    {view === null && <Notice title={c.missingTitle}>{c.missingBody}</Notice>}
    {view && <><div className="detail-meta"><span className={'severity severity-' + view.severity}>{c[view.severity]}</span><span className={'state state-' + view.state}>{c[view.state]}</span><span>{c.version} {view.version}</span><span>{c.revision} {view.target.revision_number}</span><time>{time(view.created_at, locale)}</time></div>
      {(view.assessment_status === 'partial' || dimensions.some(k => view[k].value === null)) && <Notice title={c.partialTitle}>{c.partialBody}</Notice>}
      <div className="investigation-grid"><div className="evidence-column">
        <section className="score-panel"><div className="section-label"><h2>{c.indices}</h2><span>0 — 1</span></div><Score item={view} locale={locale} /><p className="help">{c.indexMeaning}</p><div className="assessment-response"><code>{view.response_code}</code><p>{view.response_message}</p></div></section>
        <section className="findings-panel"><div className="section-label"><h2>{c.findings} <span className="count">{view.assessment.findings.length}</span></h2></div>
          <label className="checkbox"><input type="checkbox" checked={onlySelected} onChange={e => setOnlySelected(e.target.checked)} />{c.selectedOnly}</label>
          {view.assessment.findings.filter(f => !onlySelected || view.selected_risk_types.includes(f.code)).map(finding => <details className="finding" key={finding.code}>
            <summary><span className={'finding-dot status-' + finding.status} /><span><strong>{finding.title}</strong><code>{finding.code}</code></span><span className="finding-status">{catalog?.statuses.find(s => s.code === finding.status)?.label ?? c[finding.status as CopyKey] ?? finding.status}</span></summary>
            <div className="finding-body"><p>{finding.definition}</p><p className="reason">{finding.reason}</p>
              {finding.metric ? <dl className="metric-pair"><div><dt>{c.metric}</dt><dd><code>{finding.metric.value}</code></dd></div><div><dt>{c.threshold}</dt><dd><code>{finding.metric.threshold}</code></dd></div><div><dt>{c.coverage}</dt><dd>{catalog?.units.find(u => u.code === finding.metric!.unit)?.label ?? finding.metric.unit}</dd></div></dl> : <p className="help">{c.noEvidence}</p>}
              <h3>{c.condition}</h3><p>{finding.condition}</p><h3>{c.limitation}</h3><p className="muted">{finding.limitation}</p>
              {!!finding.evidence_refs.length && <><h3>{c.evidence}</h3><ul className="evidence-refs">{finding.evidence_refs.map((ref, i) => <li key={ref.namespace + ref.transaction_id + ref.revision_number + i}><code>{ref.namespace} / {ref.transaction_id}</code><span>{c.revision} {ref.revision_number}</span></li>)}</ul></>}
            </div>
          </details>)}
        </section>
        <section className="provenance"><h2>{c.provenance}</h2><dl><div><dt>{c.assessment}</dt><dd><code>{view.assessment_run_id}</code></dd></div><div><dt>{c.policy}</dt><dd><code>{view.policy.policy_id} / {view.policy.version}</code></dd></div><div><dt>{c.fingerprint}</dt><dd><code>{view.alert_snapshot_sha256}</code></dd></div><div><dt>{c.assessmentHash}</dt><dd><code>{view.assessment_sha256}</code></dd></div><div><dt>{c.viewHash}</dt><dd><code>{view.core_sha256}</code></dd></div></dl></section>
      </div><aside className="review-column">
        <section className="review-panel"><span className="eyebrow">{c.workspace}</span><h2>{c.reviewTitle}</h2><p className="help">{c.reviewIntro}</p>
          {success && <Notice tone="success">{c[success as CopyKey]}</Notice>}
          {conflict && <Notice title={c.conflictTitle}>{c.conflictBody}<button className="text-button" onClick={reload}>{c.reload}</button></Notice>}
          {saveError && !conflict && <Notice tone="error">{errorText(saveError, locale)}</Notice>}
          {!session.identity.canReview && <Notice>{c.permission}</Notice>}
          {pending && !saving && <Notice>{c.ambiguous}<div className="retry-actions"><button className="button secondary" onClick={() => void submit(pending)}>{c.retryAction}</button><button className="text-button" onClick={reload}>{c.discardRetry}</button></div></Notice>}
          {view.state === 'reviewed' ? <div className="review-complete"><span aria-hidden="true">✓</span><h3>{c.reviewedTitle}</h3><strong>{c[view.outcome as CopyKey]}</strong><p>{c.reviewedBody}</p>{(note || outcome) && <div className="unsaved-draft"><h3>{c.unsavedDraft}</h3>{outcome && <strong>{c[outcome as CopyKey]}</strong>}<p className="history-note">{note}</p></div>}</div>
            : view.state === 'open' ? <><p>{c.acknowledgeHelp}</p><button className="button primary" disabled={!fresh || saving || !!pending || !session.identity.canReview} onClick={() => void submit()}>{saving ? c.saving : c.acknowledge}<span aria-hidden="true">↗</span></button></>
              : <form onSubmit={e => { e.preventDefault(); void submit(); }} aria-busy={saving}>
                <label htmlFor="review-outcome">{c.outcome}</label><select id="review-outcome" required value={outcome} onChange={e => setOutcome(e.target.value)} disabled={saving || !!pending || !session.identity.canReview}><option value="">{c.chooseOutcome}</option>{['suspicious', 'legitimate', 'unknown'].map(v => <option key={v} value={v}>{c[v as CopyKey]}</option>)}</select>
                {outcome && <p className="help">{c[(outcome + 'Help') as CopyKey]}</p>}
                <label htmlFor="review-note">{c.note}</label><textarea id="review-note" required rows={5} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} aria-describedby="note-help" disabled={saving || !!pending || !session.identity.canReview} />
                <div className="note-count">{note.length}/1000 {c.characters}</div><p className="help" id="note-help">{c.noteHelp}</p>
                <button className="button primary" type="submit" disabled={!fresh || saving || !!pending || !outcome || !note.trim() || !session.identity.canReview}>{saving ? c.saving : c.save}<span aria-hidden="true">↗</span></button>
              </form>}
          <p className="review-meaning">{catalog?.review_semantics ?? c.reviewMeaning}</p>
        </section>
        <section className="history-panel"><h2>{c.history}<span className="count">{view.history.length}</span></h2>{view.history.length === 0 ? <p className="help">{c.noHistory}</p> : <ol>{view.history.map(event => <li key={event.request_id}><span className="history-mark">{event.version}</span><div><strong>{event.action_message}</strong><code>{event.actor_subject}</code><time>{time(event.occurred_at, locale)}</time>{event.outcome_message && <p className="history-outcome">{event.outcome_message}</p>}{event.note && <p className="history-note">{event.note}</p>}</div></li>)}</ol>}</section>
      </aside></div>
    </>}
  </>;
}
