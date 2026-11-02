import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, ServiceUnavailableException, SetMetadata, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Database } from '@lmps/database';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timestamp = (value: unknown): value is string => typeof value === 'string'
  && /^[1-9]\d{3}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const time = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const invalid = () => new BadRequestException({ code: 'INVALID_NOTIFICATION_INPUT', message: 'Invalid notification request.' });
const unavailable = () => new ServiceUnavailableException({ code: 'USER_NOTIFICATIONS_UNAVAILABLE', message: 'The user notification inbox is unavailable.' });
const severities = ['critical', 'high', 'medium', 'low'] as const;
type NotificationRow = { id: string; severity: typeof severities[number]; observed_at: string; read_at: string | null };
function notification(row: NotificationRow) {
  if (!row || !UUID.test(row.id) || !severities.includes(row.severity) || !timestamp(row.observed_at)
    || !(row.read_at === null || timestamp(row.read_at))) throw unavailable();
  return { id: row.id, title: { en: 'Risk alert', lo: 'ແຈ້ງເຕືອນຄວາມສ່ຽງ' },
    preview: { en: `A risk alert was created. Open the alert to view its evidence. Reference: ${row.id}`,
      lo: `ມີການສ້າງແຈ້ງເຕືອນຄວາມສ່ຽງ. ເປີດແຈ້ງເຕືອນເພື່ອເບິ່ງຫຼັກຖານ. ເລກອ້າງອີງ: ${row.id}` },
    reference: row.id, severity: row.severity, observed_at: row.observed_at, read_at: row.read_at,
    read: row.read_at !== null, link: { kind: 'alert' as const, alert_id: row.id } };
}

@ApiTags('local-user-notifications')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'alerts:read')
@ApiResponse({ status: 400, description: 'INVALID_NOTIFICATION_INPUT; identity/query overrides are rejected.' })
@ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN; alerts:read is required.' })
@ApiResponse({ status: 503, description: 'USER_NOTIFICATIONS_UNAVAILABLE; redacted storage error.' })
@Controller('v1/local/user-notifications')
export class UserNotificationsController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}

  @Get()
  @ApiOperation({ summary: 'Read the authenticated user inbox: one notification per workspace Alert creation, personal read receipts, never delivery status' })
  @ApiResponse({ status: 200, description: 'Complete inbox (maximum 200), unread-first then created_at DESC and ID ASC; bilingual copy, exact Alert UUID and UTC times. One statement supplies rows and as_of.' })
  @ApiResponse({ status: 422, description: 'MONITORING_SCOPE_TOO_LARGE; no partial inbox or fabricated unread count.' })
  async list(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw invalid();
    const { workspace, subject } = request.principal;
    let row;
    try {
      row = (await this.database.pool.query(`WITH clock AS MATERIALIZED (SELECT statement_timestamp() AS at), picked AS (
        SELECT a.alert_id::text AS id,a.severity,${time('a.created_at')} AS observed_at,${time('r.read_at')} AS read_at
        FROM platform.local_alerts a LEFT JOIN platform.local_user_notification_reads r
          ON r.workspace_key=a.workspace_key AND r.alert_id=a.alert_id AND r.subject=$2
        WHERE a.workspace_key=$1 ORDER BY (r.read_at IS NOT NULL),a.created_at DESC,a.alert_id LIMIT 201
      ) SELECT ${time('clock.at')} AS as_of,coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY (p.read_at IS NOT NULL),p.observed_at DESC,p.id) FROM picked p),'[]'::jsonb) AS items FROM clock`, [workspace, subject])).rows[0];
    } catch { throw unavailable(); }
    if (!row || !timestamp(row.as_of) || !Array.isArray(row.items)) throw unavailable();
    if (row.items.length > 200) throw new UnprocessableEntityException({ code: 'MONITORING_SCOPE_TOO_LARGE', message: 'The complete notification inbox exceeds 200 records.' });
    return { workspace_key: workspace, subject, provenance: 'local_synthetic', execution_mode: 'test', as_of: row.as_of,
      items: row.items.map((item: NotificationRow) => notification(item)) };
  }

  @Get('page')
  @ApiOperation({summary:'Read 50 notifications with a principal-bound keyset cursor, frozen membership/read clock and authoritative total/unread counts'})
  async page(@Req() request:ScopedRequest,@Query() query:Record<string,unknown>) {
    if(Object.keys(query).some(k=>k!=='after'))throw invalid();
    const {workspace,subject}=request.principal;
    let cutoff:string|null=null,after:string|null=null;
    if(query.after!==undefined){try{
      if(typeof query.after!=='string'||!/^[A-Za-z0-9_-]{1,1024}$/.test(query.after))throw new Error();
      const decoded=JSON.parse(Buffer.from(query.after,'base64url').toString('utf8'));
      if(!Array.isArray(decoded)||decoded.length!==5||decoded[0]!==1||decoded[1]!==workspace||decoded[2]!==subject||!timestamp(decoded[3])||!UUID.test(decoded[4])||Buffer.from(JSON.stringify(decoded)).toString('base64url')!==query.after)throw new Error();
      cutoff=decoded[3];after=decoded[4];
    }catch{throw invalid();}}
    let row;try{row=(await this.database.pool.query(`WITH clock AS MATERIALIZED (SELECT coalesce($3::timestamptz,statement_timestamp()) AS at), all_rows AS MATERIALIZED (
      SELECT a.alert_id::text AS id,a.severity,${time('a.created_at')} AS observed_at,${time('r.read_at')} AS read_at
      FROM platform.local_alerts a CROSS JOIN clock LEFT JOIN platform.local_user_notification_reads r
        ON r.workspace_key=a.workspace_key AND r.alert_id=a.alert_id AND r.subject=$2 AND r.read_at<=clock.at
      WHERE a.workspace_key=$1 AND a.created_at<=clock.at
    ), picked AS (SELECT * FROM all_rows WHERE id>coalesce($4,'') ORDER BY id LIMIT 51)
    SELECT ${time('clock.at')} AS as_of,clock.at<=statement_timestamp() AS valid_clock,
      (SELECT count(*)::text FROM all_rows) AS total,(SELECT count(*)::text FROM all_rows WHERE read_at IS NULL) AS unread_total,
      coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM picked p),'[]'::jsonb) AS items FROM clock`,[workspace,subject,cutoff,after])).rows[0];}
    catch{throw unavailable();}
    if(row?.valid_clock===false)throw invalid();
    if(!row||!timestamp(row.as_of)||!Array.isArray(row.items)||row.items.length>51)throw unavailable();
    const total=Number(row.total),unread=Number(row.unread_total);
    if(!Number.isSafeInteger(total)||!Number.isSafeInteger(unread)||unread<0||total<unread)throw unavailable();
    const items=row.items.slice(0,50).map((r:NotificationRow)=>notification(r));
    return {workspace_key:workspace,subject,provenance:'local_synthetic',execution_mode:'test',as_of:row.as_of,total,unread_total:unread,items,
      next_cursor:row.items.length>50?Buffer.from(JSON.stringify([1,workspace,subject,row.as_of,items.at(-1)!.id])).toString('base64url'):null};
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Idempotently mark only this JWT user’s notification as read; preserves the first read_at; no Alert review or delivery action' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Exact Alert-created notification ID from this inbox.' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false, maxProperties: 0 } })
  @ApiResponse({ status: 200, description: 'workspace_key, subject, id, read=true, read_at; survives reconnect/restart.' })
  @ApiResponse({ status: 404, description: 'NOTIFICATION_NOT_FOUND; unknown/foreign IDs are indistinguishable.' })
  async markRead(@Req() request: ScopedRequest, @Param('id') id: string, @Query() query: Record<string, unknown>, @Body() input: unknown) {
    if (!UUID.test(id) || Object.keys(query).length || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw invalid();
    const { workspace, subject } = request.principal;
    let rows;
    try {
      rows = (await this.database.pool.query(`SELECT ${time('r.read_at')} AS read_at FROM platform.read_local_user_notification($1,$2,$3::uuid) r`, [workspace, subject, id])).rows;
    } catch { throw unavailable(); }
    if (!rows.length) throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' });
    if (rows.length !== 1 || !timestamp(rows[0]?.read_at)) throw unavailable();
    return { workspace_key: workspace, subject, id, read: true as const, read_at: rows[0].read_at as string };
  }
}
