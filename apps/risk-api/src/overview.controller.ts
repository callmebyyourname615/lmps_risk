import { BadRequestException, Controller, Get, Inject, Query, Req, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { readLocalAlert, readLocalCase, validateFrozenTransactionRisk, validateTransactionRevision, type Database } from '@lmps/database';
import { riskHash } from '@lmps/risk';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

const COUNT_KEYS = ['transactions', 'assessment_runs', 'assessed_latest_transactions', 'open_alerts', 'acknowledged_alerts', 'reviewed_alerts', 'open_cases', 'in_review_cases', 'closed_cases'] as const;
function safeCount(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error();
  return Number(value);
}
class RiskCalendarDay {
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty({ type: Number, minimum: 0, description: 'New stored Alerts, once per Alert ID, irrespective of review state.' }) count!: number;
}
class RiskCalendarView {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ format: 'date-time' }) as_of!: string;
  @ApiProperty({ enum: ['Asia/Vientiane'] }) timezone!: 'Asia/Vientiane';
  @ApiProperty({ enum: ['alerts_created'] }) metric!: 'alerts_created';
  @ApiProperty({ enum: ['week_aligned_year'] }) range!: 'week_aligned_year';
  @ApiProperty({ format: 'date', description: 'Sunday on or before the day364 days before today in ICT.' }) start_date!: string;
  @ApiProperty({ format: 'date' }) through_date!: string;
  @ApiProperty({ minimum: 0 }) total_alerts!: number;
  @ApiProperty({ type: [RiskCalendarDay] }) days!: RiskCalendarDay[];
}
class RiskCalendarHour {
  @ApiProperty({ minimum: 0, maximum: 23 }) hour!: number;
  @ApiProperty({ minimum: 0 }) count!: number;
}
class RiskCalendarDayView {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ format: 'date-time' }) as_of!: string;
  @ApiProperty({ enum: ['Asia/Vientiane'] }) timezone!: 'Asia/Vientiane';
  @ApiProperty({ enum: ['alerts_created'] }) metric!: 'alerts_created';
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty({ minimum: 0 }) total_alerts!: number;
  @ApiProperty({ type: [RiskCalendarHour] }) hours!: RiskCalendarHour[];
}
class OverviewView {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty({ enum: [false] }) canonical_emission!: false;
  @ApiProperty({ enum: ['unverified'] }) source_semantics!: 'unverified';
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ format: 'date-time' }) generated_at!: string;
  @ApiProperty({ enum: ['all_stored_history'] }) scope!: 'all_stored_history';
  @ApiProperty({ enum: ['repeatable_read'] }) consistency!: 'repeatable_read';
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer', minimum: 0 }, description: 'Workspace totals. Transactions are distinct namespace/ID identities at their latest revision; covered transactions have a stored risk run on that exact latest revision. Run count includes all revisions.' }) counts!: Record<typeof COUNT_KEYS[number], number>;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true }, description: 'At most five latest revisions by recorded_at descending, namespace/ID ascending; amounts remain decimal strings. Optional assessment links are recomputed from verified frozen evidence.' }) recent_transactions!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true }, description: 'At most five unreviewed alerts, severity descending then creation time descending.' }) pending_alerts!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true }, description: 'At most five open/in-review cases by updated_at descending.' }) active_cases!: Record<string, unknown>[];
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Unmeasured operational values remain null, never zero.' }) measurements!: { source_lag_seconds: null; production_tps: null; verified_account_identity: null };
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Seven calendar days through today in Asia/Vientiane. Latest revisions by recorded time, risk runs by recorded time, newly created alerts/cases. Distributions cover all stored alerts, including reviewed ones; dimension groups may overlap.' }) charts!: {
    timezone: 'Asia/Vientiane'; days: Array<{ date: string; transactions: number; assessment_runs: number; alerts_created: number; cases_created: number }>;
    alert_dimensions: Record<'fraud' | 'mule_network' | 'aml', number>;
    alert_severity: Record<'low' | 'medium' | 'high' | 'critical', number>;
  };
}

@ApiTags('local-overview')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, ['transactions:read', 'risk:read', 'alerts:read', 'cases:read'])
@ApiResponse({ status: 400, description: 'INVALID_QUERY; query fields must match the selected endpoint contract' })
@ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN; all four read scopes are required before any counts are disclosed' })
@ApiResponse({ status: 503, description: 'OVERVIEW_UNAVAILABLE; redacted storage/validation error' })
@Controller('v1/local/overview')
export class OverviewController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}

  @Get('risk-calendar/day')
  @ApiOperation({ summary: 'Read all 24 ICT hourly Alert-creation counts for a selected calendar day, bounded by the original calendar observation time.' })
  @ApiQuery({ name: 'date', required: true, type: String, description: 'YYYY-MM-DD within the original ICT calendar range.' })
  @ApiQuery({ name: 'as_of', required: true, type: String, description: 'Original calendar observation timestamp in UTC with six fractional digits; cannot be in the future.' })
  @ApiOkResponse({ type: RiskCalendarDayView })
  async calendarDay(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>): Promise<RiskCalendarDayView> {
    const invalid = (): never => { throw new BadRequestException({ code: 'INVALID_QUERY', message: 'Invalid risk calendar day or observation time.' }); };
    const date = query.date, asOf = query.as_of;
    if (Object.keys(query).sort().join(',') !== 'as_of,date' || typeof date !== 'string' || !/^[1-9]\d{3}-\d\d-\d\d$/.test(date)
      || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date
      || typeof asOf !== 'string' || !/^[1-9]\d{3}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(asOf)
      || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 19) !== asOf.slice(0, 19)) return invalid();
    const today = new Date(Date.parse(asOf) + 7 * 3600000).toISOString().slice(0, 10);
    let first = Date.parse(today) - 364 * 86400000; first -= new Date(first).getUTCDay() * 86400000;
    if (date < new Date(first).toISOString().slice(0, 10) || date > today) return invalid();
    try {
      const { rows: [row] } = await this.database.pool.query(`WITH bounds AS MATERIALIZED (
        SELECT $2::timestamptz AS cutoff,$3::date AS day,statement_timestamp() AS now,
          $3::date::timestamp AT TIME ZONE 'Asia/Vientiane' AS first,
          ($3::date+1)::timestamp AT TIME ZONE 'Asia/Vientiane' AS last
      ), activity AS (
        SELECT extract(hour FROM a.created_at AT TIME ZONE 'Asia/Vientiane')::integer AS hour,count(*)::text AS n
        FROM platform.local_alerts a CROSS JOIN bounds b WHERE a.workspace_key=$1
          AND a.created_at>=b.first AND a.created_at<b.last AND a.created_at<=b.cutoff GROUP BY hour
      ) SELECT b.cutoff<=b.now AS valid_cutoff,
        (SELECT jsonb_agg(jsonb_build_object('hour',h.hour,'count',coalesce(a.n,'0')) ORDER BY h.hour)
          FROM generate_series(0,23) h(hour) LEFT JOIN activity a ON a.hour=h.hour) AS hours FROM bounds b`,
      [request.principal.workspace, asOf, date]);
      if (row?.valid_cutoff === false) return invalid();
      if (!row || row.valid_cutoff !== true || !Array.isArray(row.hours) || row.hours.length !== 24) throw new Error();
      const hours = row.hours.map((hour: { hour: number; count: unknown }, index: number) => {
        if (hour.hour !== index) throw new Error();
        return { hour: index, count: safeCount(hour.count) };
      });
      const total = hours.reduce((sum: number, hour: RiskCalendarHour) => sum + hour.count, 0);
      if (!Number.isSafeInteger(total)) throw new Error();
      return { provenance: 'local_synthetic', execution_mode: 'test', workspace_key: request.principal.workspace,
        as_of: asOf, timezone: 'Asia/Vientiane', metric: 'alerts_created', date, total_alerts: total, hours };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException({ code: 'OVERVIEW_UNAVAILABLE', message: 'Risk calendar day is unavailable.' });
    }
  }

  @Get('risk-calendar')
  @ApiOperation({ summary: 'Read a week-aligned trailing year of newly created Alerts in ICT, one count per day through the observation clock; no source-event or risk-score inference' })
  @ApiOkResponse({ type: RiskCalendarView })
  async calendar(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>): Promise<RiskCalendarView> {
    if (Object.keys(query).length) throw new BadRequestException({ code: 'INVALID_QUERY', message: 'Risk calendar accepts no query parameters.' });
    try {
      const { rows: [row] } = await this.database.pool.query(`WITH clock AS MATERIALIZED (
        SELECT statement_timestamp() AS at,(statement_timestamp() AT TIME ZONE 'Asia/Vientiane')::date AS today
      ), dates AS (
        SELECT today-364-extract(dow FROM today-364)::integer AS first,today,at FROM clock
      ), activity AS (
        SELECT (a.created_at AT TIME ZONE 'Asia/Vientiane')::date AS day,count(*)::text AS n
        FROM platform.local_alerts a CROSS JOIN dates d WHERE a.workspace_key=$1
          AND a.created_at>=d.first::timestamp AT TIME ZONE 'Asia/Vientiane'
          AND a.created_at<=d.at
        GROUP BY day
      ), days AS (
        SELECT d.first+i AS day FROM dates d CROSS JOIN LATERAL generate_series(0,d.today-d.first) i
      ) SELECT to_char(d.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS as_of,
        to_char(d.first,'YYYY-MM-DD') AS start_date,to_char(d.today,'YYYY-MM-DD') AS through_date,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('date',to_char(days.day,'YYYY-MM-DD'),'count',coalesce(a.n,'0')) ORDER BY days.day),'[]'::jsonb)
          FROM days LEFT JOIN activity a ON a.day=days.day) AS days FROM dates d`, [request.principal.workspace]);
      if (!row || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(row.as_of) || !Array.isArray(row.days)) throw new Error();
      const days = row.days.map((day: { date: string; count: unknown }) => ({ date: day.date, count: safeCount(day.count) }));
      const total_alerts = days.reduce((n: number, day: RiskCalendarDay) => n + day.count, 0);
      if (!Number.isSafeInteger(total_alerts)) throw new Error();
      return { provenance: 'local_synthetic', execution_mode: 'test', workspace_key: request.principal.workspace, as_of: row.as_of,
        timezone: 'Asia/Vientiane', metric: 'alerts_created', range: 'week_aligned_year', start_date: row.start_date, through_date: row.through_date, total_alerts, days };
    } catch (error) {
      throw new ServiceUnavailableException({ code: 'OVERVIEW_UNAVAILABLE', message: 'Risk calendar is unavailable.' });
    }
  }

  @Get()
  @ApiOperation({ summary: 'Read one consistent workspace monitoring summary; all stored local history, no institution/time inference or production telemetry' })
  @ApiOkResponse({ type: OverviewView })
  async read(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>): Promise<OverviewView> {
    if (Object.keys(query).length) throw new BadRequestException({ code: 'INVALID_QUERY', message: 'Overview accepts no query parameters.' });
    const workspace = request.principal.workspace;
    const client = await this.database?.pool.connect().catch(() => null);
    if (!client) throw new ServiceUnavailableException({ code: 'OVERVIEW_UNAVAILABLE', message: 'Workspace summary is unavailable.' });
    try {
      // One snapshot for totals, selected rows and existing evidence validators.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='5s'");
      const { rows: [totals] } = await client.query(`WITH latest AS (
        SELECT DISTINCT ON(namespace,transaction_id) namespace,transaction_id,revision_number
        FROM platform.local_transaction_revisions WHERE workspace_key=$1 ORDER BY namespace,transaction_id,revision_number DESC
      ), alerts AS (
        SELECT a.alert_id,coalesce(max(h.version),0) AS version FROM platform.local_alerts a
        LEFT JOIN platform.local_alert_reviews h ON (h.workspace_key,h.alert_id)=(a.workspace_key,a.alert_id)
        WHERE a.workspace_key=$1 GROUP BY a.alert_id
      ) SELECT
        to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS generated_at,
        (SELECT count(*)::text FROM latest) AS transactions,
        (SELECT count(*)::text FROM platform.local_transaction_risks WHERE workspace_key=$1) AS assessment_runs,
        (SELECT count(*)::text FROM latest l WHERE EXISTS(SELECT 1 FROM platform.local_transaction_risks r
          WHERE r.workspace_key=$1 AND (r.namespace,r.transaction_id,r.revision_number)=(l.namespace,l.transaction_id,l.revision_number))) AS assessed_latest_transactions,
        (SELECT count(*)::text FROM alerts WHERE version=0) AS open_alerts,
        (SELECT count(*)::text FROM alerts WHERE version=1) AS acknowledged_alerts,
        (SELECT count(*)::text FROM alerts WHERE version=2) AS reviewed_alerts,
        (SELECT count(*)::text FROM platform.local_cases WHERE workspace_key=$1 AND state='open') AS open_cases,
        (SELECT count(*)::text FROM platform.local_cases WHERE workspace_key=$1 AND state='in_review') AS in_review_cases,
        (SELECT count(*)::text FROM platform.local_cases WHERE workspace_key=$1 AND state='closed') AS closed_cases`, [workspace]);
      const counts = Object.fromEntries(COUNT_KEYS.map(key => [key, safeCount(totals[key])])) as OverviewView['counts'];
      const daily = await client.query(`WITH latest AS (
        SELECT DISTINCT ON(namespace,transaction_id) recorded_at FROM platform.local_transaction_revisions
        WHERE workspace_key=$1 ORDER BY namespace,transaction_id,revision_number DESC
      ), bounds AS (
        SELECT ((transaction_timestamp() AT TIME ZONE 'Asia/Vientiane')::date-6)::timestamp AT TIME ZONE 'Asia/Vientiane' AS start_at
      ), events AS (
        SELECT recorded_at AS at,'transactions' AS kind FROM latest
        UNION ALL SELECT recorded_at,'assessment_runs' FROM platform.local_transaction_risks WHERE workspace_key=$1
        UNION ALL SELECT created_at,'alerts_created' FROM platform.local_alerts WHERE workspace_key=$1
        UNION ALL SELECT created_at,'cases_created' FROM platform.local_cases WHERE workspace_key=$1
      ), activity AS (
        SELECT (at AT TIME ZONE 'Asia/Vientiane')::date AS day,kind,count(*) AS n FROM events,bounds
        WHERE at>=bounds.start_at AND at<=transaction_timestamp() GROUP BY day,kind
      ), days AS (
        SELECT (transaction_timestamp() AT TIME ZONE 'Asia/Vientiane')::date-i AS day FROM generate_series(6,0,-1) i
      ) SELECT to_char(days.day,'YYYY-MM-DD') AS date,
        coalesce(sum(n) FILTER(WHERE kind='transactions'),0)::text AS transactions,
        coalesce(sum(n) FILTER(WHERE kind='assessment_runs'),0)::text AS assessment_runs,
        coalesce(sum(n) FILTER(WHERE kind='alerts_created'),0)::text AS alerts_created,
        coalesce(sum(n) FILTER(WHERE kind='cases_created'),0)::text AS cases_created
        FROM days LEFT JOIN activity USING(day) GROUP BY days.day ORDER BY days.day`, [workspace]);
      const distribution = (await client.query(`SELECT
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(snapshot->'selected_risk_types') code WHERE code ~ '^FRAUD_'))::text AS fraud,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(snapshot->'selected_risk_types') code WHERE code ~ '^MULE_'))::text AS mule_network,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(snapshot->'selected_risk_types') code WHERE code ~ '^AML_'))::text AS aml,
        count(*) FILTER(WHERE severity='low')::text AS low,count(*) FILTER(WHERE severity='medium')::text AS medium,
        count(*) FILTER(WHERE severity='high')::text AS high,count(*) FILTER(WHERE severity='critical')::text AS critical
        FROM platform.local_alerts WHERE workspace_key=$1`, [workspace])).rows[0];
      const charts: OverviewView['charts'] = {
        timezone: 'Asia/Vientiane',
        days: daily.rows.map(row => ({ date: row.date, transactions: safeCount(row.transactions), assessment_runs: safeCount(row.assessment_runs), alerts_created: safeCount(row.alerts_created), cases_created: safeCount(row.cases_created) })),
        alert_dimensions: { fraud: safeCount(distribution.fraud), mule_network: safeCount(distribution.mule_network), aml: safeCount(distribution.aml) },
        alert_severity: { low: safeCount(distribution.low), medium: safeCount(distribution.medium), high: safeCount(distribution.high), critical: safeCount(distribution.critical) },
      };
      const recent = await client.query(`WITH latest AS (
        SELECT DISTINCT ON(namespace,transaction_id) * FROM platform.local_transaction_revisions
        WHERE workspace_key=$1 ORDER BY namespace,transaction_id,revision_number DESC
      ) SELECT l.namespace,l.transaction_id,l.revision_number,l.payload,l.publication,
        to_char(l.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,
        r.run_id::text,r.snapshot,r.snapshot_sha256
        FROM latest l LEFT JOIN LATERAL (SELECT run_id,snapshot,snapshot_sha256 FROM platform.local_transaction_risks
          WHERE workspace_key=$1 AND (namespace,transaction_id,revision_number)=(l.namespace,l.transaction_id,l.revision_number)
          ORDER BY recorded_at DESC,run_id DESC LIMIT 1) r ON true
        ORDER BY l.recorded_at DESC,l.namespace,l.transaction_id LIMIT 5`, [workspace]);
      const recent_transactions = recent.rows.map(row => {
        const value = validateTransactionRevision({ format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: workspace,
          expected_revision: row.revision_number - 1, transaction: row.payload, ...(row.publication === null ? {} : { publication: row.publication }) });
        if (value.transaction.transaction_id !== row.transaction_id || value.transaction.source_reference.namespace !== row.namespace) throw new Error();
        let assessment = null;
        if (row.run_id !== null) {
          const result = validateFrozenTransactionRisk(row.snapshot, row.snapshot_sha256).result;
          if (result.workspace_key !== workspace || result.run_id !== row.run_id || result.target.namespace !== row.namespace
            || result.target.transaction_id !== row.transaction_id || result.target.revision_number !== row.revision_number) throw new Error();
          assessment = { run_id: result.run_id, core_sha256: riskHash(result) };
        }
        return { namespace: row.namespace, transaction_id: row.transaction_id, revision_number: row.revision_number,
          amount: value.transaction.amount, currency: value.transaction.currency, recorded_at: row.recorded_at, assessment };
      });
      const alerts = await client.query(`SELECT a.alert_id::text FROM platform.local_alerts a
        WHERE a.workspace_key=$1 AND NOT EXISTS(SELECT 1 FROM platform.local_alert_reviews h
          WHERE (h.workspace_key,h.alert_id)=(a.workspace_key,a.alert_id) AND h.version=2)
        ORDER BY CASE a.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,date_trunc('milliseconds',a.created_at) DESC,a.alert_id LIMIT 5`, [workspace]);
      const pending_alerts = [];
      for (const row of alerts.rows) {
        const view = await readLocalAlert(client, workspace, row.alert_id);
        if (!view) throw new Error();
        pending_alerts.push({ alert_id: view.alert_id, severity: view.snapshot.severity, state: view.state, created_at: view.created_at });
      }
      const cases = await client.query(`SELECT case_id::text FROM platform.local_cases
        WHERE workspace_key=$1 AND state IN ('open','in_review') ORDER BY date_trunc('milliseconds',updated_at) DESC,case_id LIMIT 5`, [workspace]);
      const active_cases = [];
      for (const row of cases.rows) {
        const view = await readLocalCase(client, workspace, row.case_id);
        if (!view) throw new Error();
        active_cases.push({ case_id: view.case_id, title: view.title, state: view.state, updated_at: view.updated_at });
      }
      await client.query('COMMIT');
      return { provenance: 'local_synthetic', execution_mode: 'test', canonical_emission: false, source_semantics: 'unverified', workspace_key: workspace,
        generated_at: totals.generated_at, scope: 'all_stored_history', consistency: 'repeatable_read', counts, charts, recent_transactions, pending_alerts, active_cases,
        measurements: { source_lag_seconds: null, production_tps: null, verified_account_identity: null } };
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      throw new ServiceUnavailableException({ code: 'OVERVIEW_UNAVAILABLE', message: 'Workspace summary is unavailable.' });
    } finally { client.release(true); }
  }
}
