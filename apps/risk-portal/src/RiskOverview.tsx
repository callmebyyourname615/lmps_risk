import type { AlertSummary, Catalog, Locale } from './client.ts';
import { copy } from './copy.ts';
import { prioritizeAlerts, summarizeAlerts } from './overview.ts';

export function RiskOverview({ items, catalog, locale }: { items: AlertSummary[]; catalog?: Catalog; locale: Locale }) {
  const c = copy(locale), summary = summarizeAlerts(items);
  return <div className="monitor-grid">
    <section className="monitor-panel monitor-hero" aria-labelledby="snapshot-title">
      <div className="panel-heading"><h2 id="snapshot-title">{c.snapshot}</h2><span className="environment-pill">{c.loaded}</span></div>
      <div className="snapshot-total"><strong>{summary.total.toLocaleString(locale === 'lo' ? 'lo-LA' : 'en-GB')}</strong><div><span>{c.pageAlerts}</span><small>{c.indexScale}</small></div></div>
      <div className="dimension-cards">{summary.dimensions.map((dimension, i) => <article className="dimension-card" data-dimension={dimension.label} key={dimension.key}>
        <span className="dimension-symbol" aria-hidden="true">{['◇', '⌘', '◎'][i]}</span><h3>{c[dimension.label]}</h3>
        <span className="dimension-value">{dimension.average === null ? '—' : dimension.average.toFixed(3)}</span>
        <span className="dimension-description">{c.dimensionAverage}</span>
        {dimension.average === null ? <span className="unavailable-line" /> : <meter min={0} max={1} value={dimension.average} aria-label={c[dimension.label] + ': ' + c.dimensionAverage} />}
        <small>{c.scoredAlerts} <b>{dimension.available}/{summary.total}</b></small>
        <small>{c.unavailableScores} <b>{dimension.unavailable}</b></small>
      </article>)}</div>
      <p className="scope-note">{c.snapshotScope} {c.indexMeaning}</p>
    </section>
    <section className="monitor-panel monitor-workflow" aria-labelledby="workflow-title">
      <h2 id="workflow-title">{c.workflow}</h2>
      <div className="pending-total"><strong>{summary.pending}</strong><span>{c.needsReview}</span></div>
      <dl className="workflow-states">{(['open', 'acknowledged', 'reviewed'] as const).map(state => <div key={state}><dt><span className={'state-dot state-dot-' + state} />{c[state]}</dt><dd>{summary.states[state]}</dd></div>)}</dl>
      <div className="monitor-flags"><div><span>{c.priority}</span><strong>{summary.priority}</strong></div><div><span>{c.incomplete}</span><strong>{summary.incomplete}</strong></div></div>
      <a className="button primary" href="#/">{c.openInbox}<span aria-hidden="true">↗</span></a>
    </section>
    <section className="monitor-panel monitor-queue" aria-labelledby="queue-title">
      <div className="panel-heading"><div><h2 id="queue-title">{c.queueTitle}</h2><p className="help">{c.queueIntro}</p></div><span className="count">{items.length}</span></div>
      {items.length ? <ol className="overview-queue">{prioritizeAlerts(items).map(item => <li key={item.alert_id}>
        <a href={'#/alerts/' + item.alert_id} className="overview-alert-link"><span className={'queue-marker severity-marker-' + item.severity} aria-hidden="true" /><span className="queue-identity"><strong>{item.target.transaction_id}</strong><small>{c.revision} {item.target.revision_number} · {item.selected_risk_types.length} {c.signals}</small></span><span className={'severity severity-' + item.severity}>{c[item.severity]}</span><span className={'state state-' + item.state}>{c[item.state]}</span><span aria-hidden="true" className="queue-open">↗</span></a>
      </li>)}</ol> : <div className="overview-empty"><h3>{c.snapshotEmpty}</h3><p>{c.emptyBody}</p></div>}
    </section>
    <section className="monitor-panel monitor-library" aria-labelledby="library-title">
      <div className="panel-heading"><h2 id="library-title">{c.detectorLibrary}</h2><span className="library-count">{catalog ? catalog.risk_types.length : '—'}</span></div>
      <p className="help">{c.detectorIntro}</p>
      <div className="library-types">{summary.dimensions.map(d => <a key={d.label} href="#/definitions"><span>{c[d.label]}</span><span className="dimension-symbol" aria-hidden="true">↗</span></a>)}</div>
      <a className="button secondary" href="#/definitions">{c.viewDefinitions}<span aria-hidden="true">↗</span></a>
    </section>
  </div>;
}
