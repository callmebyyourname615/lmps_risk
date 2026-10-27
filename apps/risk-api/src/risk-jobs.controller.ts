import { ArgumentsHost, Catch, Controller, ExceptionFilter, Get, HttpException, Inject, Param, Query, Req, Res, SetMetadata, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { listRiskJobs, readRiskJob, readRiskJobAttempts, RiskJobError, type Database } from '@lmps/database';
import { ALERT_UUID, riskMessage, alertText, selectRiskLocale } from '@lmps/risk';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

const messages: Record<string, [string, string]> = {
  pending: ['Pending', 'ລໍຖ້າ'], running: ['Running', 'ກຳລັງເຮັດວຽກ'], retry_wait: ['Waiting to retry', 'ລໍຖ້າລອງໃໝ່'],
  completed: ['Completed', 'ສຳເລັດ'], failed: ['Failed', 'ລົ້ມເຫຼວ'], interrupted: ['Lease expired; awaiting recovery', 'ສິດເຮັດວຽກໝົດອາຍຸ; ລໍຖ້າກູ້ຄືນ'],
  assessment: ['Risk assessment', 'ປະເມີນຄວາມສ່ຽງ'], alert: ['Alert generation', 'ສ້າງການແຈ້ງເຕືອນ'], done: ['Finished', 'ເຮັດວຽກຄົບແລ້ວ'],
  JOB_STORAGE_UNAVAILABLE: ['Job storage is unavailable; diagnostics withheld.', 'ຂໍ້ມູນວຽກບໍ່ພ້ອມ; ບໍ່ສະແດງລາຍລະອຽດພາຍໃນ.'],
  JOB_INVALID_INPUT: ['Invalid job query.', 'ຄຳຂໍຂໍ້ມູນວຽກບໍ່ຖືກຕ້ອງ.'],
  JOB_INPUT_CONFLICT: ['Job input conflicts with saved input.', 'ຂໍ້ມູນວຽກຂັດກັບຂໍ້ມູນທີ່ບັນທຶກ.'],
  JOB_STALE_LEASE: ['This worker no longer owns the job.', 'ຕົວເຮັດວຽກນີ້ບໍ່ມີສິດເຮັດວຽກນີ້ແລ້ວ.'],
  JOB_LEASE_EXPIRED: ['The worker lease expired.', 'ສິດຂອງຕົວເຮັດວຽກໝົດອາຍຸ.'],
  RISK_POLICY_CONFLICT: ['Risk policy version conflicts with stored evidence.', 'ເວີຊັນນະໂຍບາຍຄວາມສ່ຽງຂັດກັບຫຼັກຖານທີ່ບັນທຶກ.'],
  RISK_RUN_CONFLICT: ['Assessment identity conflicts with stored evidence.', 'ລະຫັດການປະເມີນຂັດກັບຫຼັກຖານທີ່ບັນທຶກ.'],
};
const text = (code: string, locale: 'lo' | 'en') => messages[code]?.[locale === 'en' ? 0 : 1] ?? (code.startsWith('ALERT_') ? alertText(code, locale) : riskMessage(code, locale));
const invalid = () => new RiskJobError('JOB_INVALID_INPUT');
@Catch()
class JobResponseFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp(), request = http.getRequest<ScopedRequest>(), reply = http.getResponse<FastifyReply>();
    const locale = selectRiskLocale(request.headers['accept-language']), body = error instanceof HttpException ? error.getResponse() : null;
    const proposed = error instanceof RiskJobError ? error.code : body && typeof body === 'object' && 'code' in body ? body.code : null;
    const code = ['JOB_INVALID_INPUT', 'UNAUTHORIZED', 'FORBIDDEN'].includes(String(proposed)) ? String(proposed) : 'JOB_STORAGE_UNAVAILABLE';
    reply.header('Content-Language', locale).header('Vary', 'Accept-Language').header('Cache-Control', 'no-store')
      .status(code === 'JOB_INVALID_INPUT' ? 400 : code === 'UNAUTHORIZED' ? 401 : code === 'FORBIDDEN' ? 403 : 503).send({ code, locale, message: text(code, locale) });
  }
}
@ApiTags('local-risk-jobs')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'risk-jobs:read')
@UseFilters(JobResponseFilter)
@ApiResponse({ status: 400, description: 'JOB_INVALID_INPUT; localized' })
@ApiResponse({ status: 401, description: 'UNAUTHORIZED; localized' })
@ApiResponse({ status: 403, description: 'FORBIDDEN; localized' })
@ApiResponse({ status: 503, description: 'JOB_STORAGE_UNAVAILABLE; redacted' })
@Controller('v1/local/risk-jobs')
export class RiskJobsController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}
  private locale(request: ScopedRequest, reply: FastifyReply) {
    const locale = selectRiskLocale(request.headers['accept-language']); reply.header('Content-Language', locale).header('Vary', 'Accept-Language'); return locale;
  }
  private view(row: Record<string, unknown>, locale: 'lo' | 'en') {
    return { ...row, status_message: text(String(row.effective_status), locale),
      ...(row.stage ? { stage_message: text(String(row.stage), locale) } : { started_stage_message: text(String(row.started_stage), locale), finished_stage_message: row.finished_stage ? text(String(row.finished_stage), locale) : null }),
      error_message: row.error_code ? text(String(row.error_code), locale) : null,
      ...(Object.hasOwn(row, 'result_code') ? { result_message: row.result_code ? text(String(row.result_code), locale) : null } : {}) };
  }
  @Get()
  @ApiOperation({ summary: 'Read workspace jobs in live UUID order; metadata only, not an incremental feed' })
  @ApiQuery({ name: 'after', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 10 })
  @ApiOkResponse({ description: 'locale, items (job_ref/status/effective_status/stage/attempt_number/result references/times and localized messages), pagination and next_cursor. No manifest or lease material.' })
  async list(@Req() request: ScopedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).some(k => !['after', 'limit'].includes(k)) || (query.after !== undefined && (typeof query.after !== 'string' || !ALERT_UUID.test(query.after)))
      || (query.limit !== undefined && (typeof query.limit !== 'string' || !/^(?:[1-9]|10)$/.test(query.limit)))) throw invalid();
    const locale = this.locale(request, reply), page = await listRiskJobs(this.database.pool, request.principal.workspace, query.after as string ?? null, Number(query.limit ?? 5));
    return { locale, ...page, items: page.items.map(item => this.view(item, locale)) };
  }
  @Get(':job_ref')
  @ApiOperation({ summary: 'Read job metadata; unknown/foreign IDs return job:null' })
  @ApiParam({ name: 'job_ref', format: 'uuid' })
  @ApiOkResponse({ description: 'locale and job metadata (or null); assessment_run_id and alert_id link to independently scoped existing read APIs.' })
  async detail(@Req() request: ScopedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('job_ref') id: string, @Query() query: Record<string, unknown>) {
    if (!ALERT_UUID.test(id) || Object.keys(query).length) throw invalid();
    const locale = this.locale(request, reply), job = await readRiskJob(this.database.pool, request.principal.workspace, id);
    return { locale, job: job ? this.view(job, locale) : null };
  }
  @Get(':job_ref/attempts')
  @ApiOperation({ summary: 'Read bounded attempt history with expired leases shown as interrupted' })
  @ApiParam({ name: 'job_ref', format: 'uuid' })
  @ApiQuery({ name: 'after', required: false, type: Number, minimum: 0, maximum: 8 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 10 })
  @ApiOkResponse({ description: 'locale, job_ref, items (attempt number/status/stages/error/times), next_cursor; no lease tokens.' })
  async attempts(@Req() request: ScopedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('job_ref') id: string, @Query() query: Record<string, unknown>) {
    if (!ALERT_UUID.test(id) || Object.keys(query).some(k => !['after', 'limit'].includes(k))
      || (query.after !== undefined && (typeof query.after !== 'string' || !/^[0-8]$/.test(query.after)))
      || (query.limit !== undefined && (typeof query.limit !== 'string' || !/^(?:[1-9]|10)$/.test(query.limit)))) throw invalid();
    const locale = this.locale(request, reply), page = await readRiskJobAttempts(this.database.pool, request.principal.workspace, id, Number(query.after ?? 0), Number(query.limit ?? 5));
    return { locale, job_ref: id, ...page, items: page.items.map(item => this.view(item, locale)) };
  }
}
