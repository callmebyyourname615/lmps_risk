import { BadRequestException, Controller, Get, Inject, Param, Query, Req, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Database } from '@lmps/database';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATES = ['pending', 'leased', 'accepted', 'expired', 'dead'] as const;
const OUTCOMES = ['unknown', 'accepted', 'retry', 'permanent'] as const;
const invalid = () => new BadRequestException({ code: 'INVALID_QUERY', message: 'Invalid local notification query.' });
const unavailable = () => new ServiceUnavailableException({ code: 'NOTIFICATIONS_UNAVAILABLE', message: 'Local notification evidence is unavailable.' });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const match = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value);
const timestamp = (value: unknown): value is string => match(value, /^[1-9]\d{3}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
function page(query: Record<string, unknown>, extras: string[] = []) {
  const limit = query.limit ?? '25';
  if (Object.keys(query).some(key => !['limit', 'after', ...extras].includes(key))
    || typeof limit !== 'string' || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100) throw invalid();
  return Number(limit);
}
function decodeCursor(value: unknown, binding: unknown[], validTail: (tail: unknown) => boolean): unknown {
  try {
    if (!match(value, /^[A-Za-z0-9_-]{1,1024}$/)) throw new Error();
    const parts: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parts) || parts.length !== binding.length + 1 || binding.some((part, index) => part !== parts[index])
      || !validTail(parts.at(-1)) || Buffer.from(JSON.stringify(parts)).toString('base64url') !== value) throw new Error();
    return parts.at(-1);
  } catch { throw invalid(); }
}
const encodeCursor = (binding: unknown[], tail: unknown) => Buffer.from(JSON.stringify([...binding, tail])).toString('base64url');
const time = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

class NotificationCommon {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty({ enum: ['fake'] }) provider!: 'fake';
  @ApiProperty({ enum: ['fake_provider_only'] }) delivery_semantics!: 'fake_provider_only';
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ format: 'date-time', description: 'UTC statement timestamp with exactly six fractional digits.' }) as_of!: string;
}
class IntentView {
  @ApiProperty({ format: 'uuid' }) intent_ref!: string;
  @ApiProperty({ format: 'uuid', description: 'Opaque notification reference; not an Alert, staff or device identity.' }) notification_ref!: string;
  @ApiProperty({ enum: STATES }) state!: typeof STATES[number];
  @ApiProperty({ minimum: 0, maximum: 3 }) attempt_count!: number;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
  @ApiProperty({ format: 'date-time' }) available_at!: string;
  @ApiProperty({ format: 'date-time' }) expires_at!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lease_until!: string | null;
  @ApiProperty({ description: 'Expiry deadline has elapsed as of this read; does not change stored state.' }) is_expired!: boolean;
  @ApiProperty({ description: 'A recorded lease deadline has elapsed; no lease token is exposed.' }) lease_expired!: boolean;
}
class IntentPage extends NotificationCommon {
  @ApiProperty({ enum: ['live_committed_view_uuid_order'] }) pagination!: 'live_committed_view_uuid_order';
  @ApiProperty({ type: 'object', additionalProperties: true }) filters!: { state: typeof STATES[number] | null; notification_ref: string | null };
  @ApiProperty({ type: [IntentView] }) items!: IntentView[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
class IntentDetail extends NotificationCommon {
  @ApiProperty({ type: IntentView, nullable: true }) intent!: IntentView | null;
}
class AttemptView {
  @ApiProperty({ type: String, description: 'Positive bigint as decimal text; preserve without Number conversion.' }) attempt_id!: string;
  @ApiProperty({ minimum: 1, maximum: 3 }) attempt_number!: number;
  @ApiProperty({ enum: OUTCOMES }) outcome!: typeof OUTCOMES[number];
  @ApiProperty({ format: 'date-time' }) claimed_at!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) finished_at!: string | null;
}
class AttemptPage extends NotificationCommon {
  @ApiProperty({ format: 'uuid' }) intent_ref!: string;
  @ApiProperty({ enum: ['live_committed_view_attempt_number_order'] }) pagination!: 'live_committed_view_attempt_number_order';
  @ApiProperty({ type: [AttemptView] }) items!: AttemptView[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}

// Explicit projection omits semantic keys, lease tokens, credentials and inferred Alert/recipient payloads.
const intentColumns = `i.intent_ref::text,i.notification_ref::text,i.provider,i.execution_mode,i.state,i.attempt_count,
  ${time('i.created_at')} AS created_at,${time('i.available_at')} AS available_at,
  ${time('i.expires_at')} AS expires_at,${time('i.lease_until')} AS lease_until,
  i.expires_at<=clock.at AS is_expired,coalesce(i.lease_until<=clock.at,false) AS lease_expired`;
function intent(value: unknown, asOf: string): IntentView {
  if (!object(value) || !exact(value, ['intent_ref', 'notification_ref', 'provider', 'execution_mode', 'state', 'attempt_count', 'created_at', 'available_at', 'expires_at', 'lease_until', 'is_expired', 'lease_expired'])
    || !match(value.intent_ref, UUID) || !match(value.notification_ref, UUID) || value.provider !== 'fake' || value.execution_mode !== 'test'
    || !STATES.includes(value.state as IntentView['state']) || !Number.isInteger(value.attempt_count) || Number(value.attempt_count) < 0 || Number(value.attempt_count) > 3
    || !timestamp(value.created_at) || !timestamp(value.available_at) || !timestamp(value.expires_at) || !(value.lease_until === null || timestamp(value.lease_until))
    || (value.state === 'leased') !== (value.lease_until !== null) || value.is_expired !== (value.expires_at <= asOf)
    || value.lease_expired !== (value.lease_until !== null && value.lease_until <= asOf)) throw new Error();
  const { provider: _provider, execution_mode: _mode, ...view } = value;
  return view as unknown as IntentView;
}
function attempt(value: unknown): AttemptView {
  if (!object(value) || !exact(value, ['attempt_id', 'attempt_number', 'outcome', 'claimed_at', 'finished_at', 'provider', 'execution_mode'])
    || value.provider !== 'fake' || value.execution_mode !== 'test' || !match(value.attempt_id, /^[1-9]\d{0,18}$/) || BigInt(value.attempt_id) > 9223372036854775807n
    || !Number.isInteger(value.attempt_number) || Number(value.attempt_number) < 1 || Number(value.attempt_number) > 3
    || !OUTCOMES.includes(value.outcome as AttemptView['outcome']) || !timestamp(value.claimed_at)
    || (value.outcome === 'unknown' ? value.finished_at !== null : !timestamp(value.finished_at))) throw new Error();
  const { provider: _provider, execution_mode: _mode, ...view } = value;
  return view as unknown as AttemptView;
}

@ApiTags('local-notifications')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'operations:read')
@ApiResponse({ status: 400, description: 'INVALID_QUERY' })
@ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN' })
@ApiResponse({ status: 503, description: 'NOTIFICATIONS_UNAVAILABLE; fixed redacted error' })
@Controller('v1/local/notifications')
export class NotificationsController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}

  private async read(sql: string, parameters: unknown[], workspace: string) {
    try {
      const row = (await this.database.pool.query(sql, parameters)).rows[0];
      if (!row || !timestamp(row.as_of) || !Array.isArray(row.items)) throw new Error();
      const common: NotificationCommon = { provenance: 'local_synthetic', execution_mode: 'test', provider: 'fake', delivery_semantics: 'fake_provider_only', workspace_key: workspace, as_of: row.as_of };
      return { common, rows: row.items as unknown[] };
    } catch { throw unavailable(); }
  }
  // One SQL statement supplies both the observation clock and projected rows, even for an empty page.
  private async intents(workspace: string, predicate: string, parameters: unknown[]) {
    const { common, rows } = await this.read(`WITH clock AS MATERIALIZED (SELECT statement_timestamp() AS at), picked AS (
      SELECT ${intentColumns} FROM platform.local_outbox_intents i CROSS JOIN clock
      WHERE i.workspace_key=$1 AND ${predicate}
    ) SELECT ${time('clock.at')} AS as_of,
      coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.intent_ref) FROM picked p),'[]'::jsonb) AS items FROM clock`, parameters, workspace);
    try { return { common, items: rows.map(row => intent(row, common.as_of)) }; }
    catch { throw unavailable(); }
  }

  @Get()
  @ApiOperation({ summary: 'Read stored local fake-outbox intents; live UUID order, never a user inbox or delivery receipt' })
  @ApiQuery({ name: 'state', required: false, enum: STATES })
  @ApiQuery({ name: 'notification_ref', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'after', required: false, type: String, description: 'Opaque cursor bound to workspace and both applied filters; not a stable export.' })
  @ApiOkResponse({ type: IntentPage })
  async list(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>): Promise<IntentPage> {
    const limit = page(query, ['state', 'notification_ref']), state = query.state ?? null, notification = query.notification_ref ?? null;
    if (!(state === null || typeof state === 'string' && STATES.includes(state as IntentView['state'])) || !(notification === null || match(notification, UUID))) throw invalid();
    const workspace = request.principal.workspace, binding = [1, 'notifications', workspace, state, notification];
    const after = query.after === undefined ? null : decodeCursor(query.after, binding, tail => match(tail, UUID));
    const { common, items } = await this.intents(workspace, `i.intent_ref>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      AND ($3::text IS NULL OR i.state=$3) AND ($4::uuid IS NULL OR i.notification_ref=$4::uuid) ORDER BY i.intent_ref LIMIT $5`, [workspace, after, state, notification, limit + 1]);
    return { ...common, pagination: 'live_committed_view_uuid_order', filters: { state: state as IntentView['state'] | null, notification_ref: notification as string | null },
      items: items.slice(0, limit), next_cursor: items.length > limit ? encodeCursor(binding, items[limit - 1]!.intent_ref) : null };
  }

  @Get(':intent_ref')
  @ApiOperation({ summary: 'Read one stored intent; unknown and foreign IDs both return intent=null' })
  @ApiParam({ name: 'intent_ref', format: 'uuid' })
  @ApiOkResponse({ type: IntentDetail })
  async detail(@Req() request: ScopedRequest, @Param('intent_ref') ref: string, @Query() query: Record<string, unknown>): Promise<IntentDetail> {
    if (!UUID.test(ref) || Object.keys(query).length) throw invalid();
    const { common, items } = await this.intents(request.principal.workspace, 'i.intent_ref=$2::uuid LIMIT 1', [request.principal.workspace, ref]);
    return { ...common, intent: items[0] ?? null };
  }

  @Get(':intent_ref/attempts')
  @ApiOperation({ summary: 'Read stored fake-provider attempts in attempt-number order; unknown/foreign intents return an empty page' })
  @ApiParam({ name: 'intent_ref', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'after', required: false, type: String, description: 'Opaque cursor bound to this workspace and intent, distinct from list cursors.' })
  @ApiOkResponse({ type: AttemptPage })
  async attempts(@Req() request: ScopedRequest, @Param('intent_ref') ref: string, @Query() query: Record<string, unknown>): Promise<AttemptPage> {
    const limit = page(query); if (!UUID.test(ref)) throw invalid();
    const workspace = request.principal.workspace, binding = [1, 'notification_attempts', workspace, ref];
    const after = query.after === undefined ? 0 : decodeCursor(query.after, binding, tail => typeof tail === 'number' && Number.isInteger(tail) && tail >= 1 && tail <= 3);
    const { common, rows } = await this.read(`WITH clock AS MATERIALIZED (SELECT statement_timestamp() AS at), picked AS (
      SELECT a.attempt_id::text,a.attempt_number,a.outcome,${time('a.claimed_at')} AS claimed_at,${time('a.finished_at')} AS finished_at,i.provider,i.execution_mode
      FROM platform.local_outbox_attempts a JOIN platform.local_outbox_intents i ON (i.workspace_key,i.intent_ref)=(a.workspace_key,a.intent_ref)
      WHERE a.workspace_key=$1 AND a.intent_ref=$2::uuid AND a.attempt_number>$3 ORDER BY a.attempt_number LIMIT $4
    ) SELECT ${time('clock.at')} AS as_of,coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.attempt_number) FROM picked p),'[]'::jsonb) AS items FROM clock`, [workspace, ref, after, limit + 1], workspace);
    try {
      const items = rows.map(attempt);
      return { ...common, intent_ref: ref, pagination: 'live_committed_view_attempt_number_order', items: items.slice(0, limit),
        next_cursor: items.length > limit ? encodeCursor(binding, items[limit - 1]!.attempt_number) : null };
    } catch { throw unavailable(); }
  }
}
