import { CaseResponseFilter } from './cases.controller.js';
import { CaseError } from '@lmps/risk';
import { PolicyResponseFilter } from './risk-policies.controller.js';
import { PolicyError } from '@lmps/risk';
import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, HttpException, Inject, Param, Post, Query, Req, Res, SetMetadata, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BaseExceptionFilter } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import { listLocalAlerts, readLocalAlert, type AlertView, type AlertQuery, type Database, type createAlertReviews } from '@lmps/database';
import { alertText, AlertError, localizedAlertCatalog, localizedRiskCatalog, localizeRiskResult, riskHash, riskMessage, selectRiskLocale, validateAlertReview } from '@lmps/risk';
import { ALERT_UUID, RISK_CODES, type Locale } from '@lmps/risk';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

export const ALERT_REVIEWS = Symbol('ALERT_REVIEWS');
const errors: Record<string, number> = { INVALID_ALERT_INPUT: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, ALERT_NOT_FOUND: 404,
  ALERT_REVIEW_CONFLICT: 409, ALERT_STORAGE_UNAVAILABLE: 503, ALERT_REVIEW_NOT_CONFIGURED: 503 };
@Catch()
class AlertResponseFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp(), request = http.getRequest<ScopedRequest>(), reply = http.getResponse<FastifyReply>();
    const locale = selectRiskLocale(request.headers['accept-language']), body = error instanceof HttpException ? error.getResponse() : null;
    const proposed = error instanceof AlertError ? error.code : body && typeof body === 'object' && 'code' in body ? String(body.code) : '';
    const code = Object.hasOwn(errors, proposed) ? proposed : 'ALERT_STORAGE_UNAVAILABLE';
    reply.header('Content-Language', locale).header('Vary', 'Accept-Language').header('Cache-Control', 'no-store').status(errors[code]!)
      .send({ code, locale, message: ['UNAUTHORIZED', 'FORBIDDEN'].includes(code) ? riskMessage(code, locale) : alertText(code, locale) });
  }
}
// Parsing runs before route filters; localize these errors without changing other API routes.
export class AlertParsingFilter extends BaseExceptionFilter {
  override catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<ScopedRequest>(), path = request.url.split('?')[0]!;
    const status = error instanceof HttpException ? error.getStatus() : (error as { statusCode?: number })?.statusCode;
    if ((path === '/v1/local/alerts' || path.startsWith('/v1/local/alerts/')) && status !== undefined && [400, 413, 415].includes(status)) {
      new AlertResponseFilter().catch(new AlertError('INVALID_ALERT_INPUT'), host); return;
    }
    if ((path === '/v1/local/risk-policies' || path.startsWith('/v1/local/risk-policies/')) && status !== undefined && [400,413,415].includes(status)) {
      new PolicyResponseFilter().catch(new PolicyError('POLICY_INVALID_INPUT'), host); return;
    }
    if ((path === '/v1/local/cases' || path.startsWith('/v1/local/cases/')) && status !== undefined && [400,413,415].includes(status)) {
      new CaseResponseFilter().catch(new CaseError('CASE_INVALID_INPUT'), host); return;
    }
    super.catch(error, host);
  }
}
function summary(view: AlertView, locale: Locale) {
  return { alert_id: view.alert_id, target: view.assessment.target, assessment_run_id: view.assessment.run_id,
    assessment_sha256: view.snapshot.assessment_sha256, alert_snapshot_sha256: view.snapshot_sha256,
    alert_policy: { policy_id: view.snapshot.policy.policy_id, version: view.snapshot.policy.version, sha256: riskHash(view.snapshot.policy) },
    severity: view.snapshot.severity, severity_message: alertText(view.snapshot.severity, locale), selected_risk_types: view.snapshot.selected_risk_types,
    state: view.state, state_message: alertText(view.state, locale), version: view.version, outcome: view.outcome,
    outcome_message: view.outcome === null ? null : alertText(view.outcome, locale), created_at: view.created_at,
    assessment_status: view.assessment.assessment_status, response_code: view.assessment.response_code, response_message: riskMessage(view.assessment.response_code, locale),
    fraud_score: view.assessment.fraud_score, mule_network_score: view.assessment.mule_network_score, aml_suspicion_score: view.assessment.aml_suspicion_score };
}
function detail(view: AlertView, locale: Locale) {
  return { ...summary(view, locale), core_sha256: riskHash({ alert_id: view.alert_id, snapshot: view.snapshot, history: view.history }),
    policy: view.snapshot.policy, recorded_by: view.recorded_by, assessment: localizeRiskResult(view.assessment, locale),
    history: view.history.map(event => ({ ...event, action_message: alertText(event.action, locale), outcome_message: event.outcome === null ? null : alertText(event.outcome, locale) })) };
}
function invalid(): never { throw new AlertError('INVALID_ALERT_INPUT'); }
@ApiTags('local-alerts')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'alerts:read')
@UseFilters(AlertResponseFilter)
@ApiResponse({ status: 400, description: 'INVALID_ALERT_INPUT; localized and redacted' })
@ApiResponse({ status: 401, description: 'UNAUTHORIZED; localized' })
@ApiResponse({ status: 403, description: 'FORBIDDEN; localized' })
@ApiResponse({ status: 503, description: 'ALERT_STORAGE_UNAVAILABLE or ALERT_REVIEW_NOT_CONFIGURED; localized and redacted' })
@Controller('v1/local/alerts')
export class AlertsController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database,
    @Inject(ALERT_REVIEWS) private readonly reviewer: ReturnType<typeof createAlertReviews> | null) {}
  private locale(request: ScopedRequest, reply: FastifyReply) {
    const locale = selectRiskLocale(request.headers['accept-language']); reply.header('Content-Language', locale).header('Vary', 'Accept-Language'); return locale;
  }
  @Get('catalog')
  @ApiOperation({ summary: 'Read Lao/English alert statuses, outcomes, response codes and review limitations' })
  @ApiResponse({ status: 200, description: 'Localized alert catalog' })
  catalog(@Req() request: ScopedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) invalid(); const locale = this.locale(request, reply), risk = localizedRiskCatalog(locale);
    return { ...localizedAlertCatalog(locale), risk_types: risk.risk_types, dimensions: risk.dimensions, statuses: risk.statuses, units: risk.units };
  }
  @Get()
  @ApiOperation({ summary: 'Read a workspace alert inbox; live UUID pagination, not chronological or snapshot pagination' })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 10 })
  @ApiQuery({ name: 'state', required: false, enum: ['open', 'acknowledged', 'reviewed'] })
  @ApiQuery({ name: 'severity', required: false, enum: ['low', 'medium', 'high', 'critical'] })
  @ApiQuery({ name: 'risk_code', required: false, enum: RISK_CODES })
  @ApiResponse({ status: 200, description: 'Bounded localized summaries; next_cursor is null at the end' })
  async list(@Req() request: ScopedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Query() input: Record<string, unknown>) {
    const query: AlertQuery = {};
    if (Object.keys(input).some(k => !['after', 'limit', 'state', 'severity', 'risk_code'].includes(k))
      || Object.values(input).some(value => typeof value !== 'string')) invalid();
    if (input.after !== undefined) { if (!ALERT_UUID.test(input.after as string)) invalid(); query.after = input.after as string; }
    if (input.limit !== undefined) { if (!/^[1-9]\d?$/.test(input.limit as string) || Number(input.limit) > 10) invalid(); query.limit = Number(input.limit); }
    if (input.state !== undefined) { if (!['open', 'acknowledged', 'reviewed'].includes(input.state as string)) invalid(); query.state = input.state as AlertQuery['state']; }
    if (input.severity !== undefined) { if (!['low', 'medium', 'high', 'critical'].includes(input.severity as string)) invalid(); query.severity = input.severity as string; }
    if (input.risk_code !== undefined) { if (!RISK_CODES.includes(input.risk_code as typeof RISK_CODES[number])) invalid(); query.risk_code = input.risk_code as string; }
    const locale = this.locale(request, reply), page = await listLocalAlerts(this.database.pool, request.principal.workspace, query);
    return { ...page, locale, items: page.items.map(view => summary(view, locale)) };
  }
  @Get(':alert_id')
  @ApiOperation({ summary: 'Read immutable alert/assessment evidence and protected review history; null for unknown/foreign workspace' })
  @ApiResponse({ status: 200, description: 'Localized alert details or alert=null' })
  async detail(@Req() request: ScopedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('alert_id') id: string, @Query() query: Record<string, unknown>) {
    if (!ALERT_UUID.test(id) || Object.keys(query).length) invalid(); const locale = this.locale(request, reply);
    const view = await readLocalAlert(this.database.pool, request.principal.workspace, id);
    return { locale, alert: view ? detail(view, locale) : null };
  }
  @Post(':alert_id/reviews')
  @SetMetadata(LOCAL_SCOPE, ['alerts:read', 'alerts:review'])
  @ApiOperation({ summary: 'Acknowledge (version0) then review (version1); request_id retries are idempotent; actor comes only from JWT' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false, required: ['request_id', 'expected_version', 'action', 'outcome', 'note'], properties: {
    request_id: { type: 'string', format: 'uuid' }, expected_version: { type: 'integer', minimum: 0, maximum: 1 },
    action: { type: 'string', enum: ['acknowledge', 'review'] }, outcome: { type: 'string', enum: ['suspicious', 'legitimate', 'unknown'], nullable: true },
    note: { type: 'string', minLength: 1, maxLength: 1000, nullable: true },
  } } })
  @ApiResponse({ status: 201, description: 'Inserted or duplicate review event with current localized alert details' })
  @ApiResponse({ status: 404, description: 'ALERT_NOT_FOUND; foreign and unknown IDs behave alike' })
  @ApiResponse({ status: 409, description: 'ALERT_REVIEW_CONFLICT; reload before a new action' })
  async review(@Req() request: ScopedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('alert_id') id: string,
    @Query() query: Record<string, unknown>, @Body() input: unknown) {
    if (!ALERT_UUID.test(id) || Object.keys(query).length) invalid(); const command = validateAlertReview(input);
    if (!this.reviewer) throw new AlertError('ALERT_REVIEW_NOT_CONFIGURED');
    const locale = this.locale(request, reply), result = await this.reviewer.review(request.principal.workspace, id, request.principal.subject, command);
    return { locale, status: result.status, alert: detail(result.view, locale) };
  }
}
