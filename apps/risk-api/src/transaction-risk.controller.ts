import { ArgumentsHost, BadRequestException, Catch, Controller, ExceptionFilter, Get, HttpException, Inject, Param, Query, Req, Res, SetMetadata, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { validateFrozenTransactionRisk, type Database } from '@lmps/database';
import { localizeRiskResult, localizedRiskCatalog, riskHash, RiskError, riskMessage, selectRiskLocale, type TransactionRiskResult } from '@lmps/risk';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

@Catch()
class RiskResponseFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp(), request = http.getRequest<ScopedRequest>(), reply = http.getResponse<FastifyReply>();
    const locale = selectRiskLocale(request.headers['accept-language']);
    const body = error instanceof HttpException ? error.getResponse() : null;
    const proposed = body && typeof body === 'object' && 'code' in body ? String(body.code) : error instanceof RiskError ? error.code : 'RISK_STORAGE_UNAVAILABLE';
    const code = ['INVALID_QUERY', 'UNAUTHORIZED', 'FORBIDDEN'].includes(proposed) ? proposed : 'RISK_STORAGE_UNAVAILABLE';
    const status = code === 'INVALID_QUERY' ? 400 : code === 'UNAUTHORIZED' ? 401 : code === 'FORBIDDEN' ? 403 : 503;
    reply.header('Content-Language', locale).header('Vary', 'Accept-Language').header('Cache-Control', 'no-store').status(status)
      .send({ code, locale, message: riskMessage(code, locale) });
  }
}
class TransactionRiskDetail {
  @ApiProperty({ enum: ['lo', 'en'] }) locale!: string;
  @ApiProperty({ type: String, nullable: true }) core_sha256!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'Frozen per-revision result with three dimension scores,15 detector outcomes, codes, evidence, coverage and localized text. Null for foreign/unknown IDs. Index values are not probabilities.' }) assessment!: TransactionRiskResult | null;
}
class TransactionRiskPage {
  @ApiProperty({ enum: ['lo', 'en'] }) locale!: string;
  @ApiProperty({ enum: ['live_committed_view'] }) pagination!: string;
  @ApiProperty({ type: [TransactionRiskDetail] }) items!: TransactionRiskDetail[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
class RiskCatalogView {
  @ApiProperty() catalog_version!: string;
  @ApiProperty({ enum: ['lo', 'en'] }) locale!: string;
  @ApiProperty({ type: [String] }) supported_locales!: string[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) aliases!: Record<string, string>;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) risk_types!: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) codes!: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) statuses!: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) dimensions!: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) units!: unknown[];
  @ApiProperty() score_semantics!: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid = () => new BadRequestException({ code: 'INVALID_QUERY' });

@ApiTags('local-transaction-risk')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'risk:read')
@UseFilters(RiskResponseFilter)
@ApiResponse({ status: 400, description: 'INVALID_QUERY; localized' })
@ApiResponse({ status: 401, description: 'UNAUTHORIZED; localized' })
@ApiResponse({ status: 403, description: 'FORBIDDEN; localized' })
@ApiResponse({ status: 503, description: 'RISK_STORAGE_UNAVAILABLE; localized redacted message' })
@Controller('v1/local')
export class TransactionRiskController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}
  private locale(request: ScopedRequest, reply: FastifyReply) {
    const locale = selectRiskLocale(request.headers['accept-language']);
    reply.header('Content-Language', locale).header('Vary', 'Accept-Language'); return locale;
  }
  @Get('risk/catalog')
  @ApiOperation({ summary: 'Read risk definitions, codes and limitations in Lao or English; Accept-Language defaults to lo, accepts la alias, falls back to en' })
  @ApiOkResponse({ type: RiskCatalogView })
  catalog(@Req() request: ScopedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw invalid();
    return localizedRiskCatalog(this.locale(request, reply));
  }

  @Get('risk-assessments/:run_id')
  @ApiOperation({ summary: 'Read frozen per-transaction risk evidence; translating does not change codes, numbers or core hash' })
  @ApiOkResponse({ type: TransactionRiskDetail })
  async detail(@Req() request: ScopedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param('run_id') id: string, @Query() query: Record<string, unknown>) {
    if (!uuid.test(id) || Object.keys(query).length) throw invalid();
    const locale = this.locale(request, reply);
    const rows = await this.database.pool.query(`SELECT run_id::text,namespace,transaction_id,revision_number,snapshot,snapshot_sha256
      FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=$2`, [request.principal.workspace, id]);
    return rows.rows[0] ? this.view(rows.rows[0], request.principal.workspace, locale) : { locale, core_sha256: null, assessment: null };
  }

  @Get('transactions/:namespace/:transaction_id/revisions/:revision_number/risk-assessments')
  @ApiOperation({ summary: 'Read bounded risk history for one explicit transaction revision, in UUID order (not chronological)' })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 10 })
  @ApiOkResponse({ type: TransactionRiskPage })
  async history(@Req() request: ScopedRequest, @Res({ passthrough: true }) reply: FastifyReply,
    @Param('namespace') namespace: string, @Param('transaction_id') id: string, @Param('revision_number') revision: string, @Query() query: Record<string, unknown>) {
    const after = query.after ?? null, limit = query.limit ?? '5';
    if (!/^synthetic_[a-z0-9_]{1,40}$/.test(namespace) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)
      || !/^[1-9]\d{0,9}$/.test(revision) || Number(revision) > 2147483647 || (after !== null && (typeof after !== 'string' || !uuid.test(after)))
      || typeof limit !== 'string' || !/^[1-9]\d?$/.test(limit) || Number(limit) > 10 || Object.keys(query).some(key => !['after', 'limit'].includes(key))) throw invalid();
    const locale = this.locale(request, reply);
    const result = await this.database.pool.query(`SELECT run_id::text,namespace,transaction_id,revision_number,snapshot,snapshot_sha256
      FROM platform.local_transaction_risks WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=$3 AND revision_number=$4
      AND run_id>COALESCE($5::uuid,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY run_id LIMIT $6`,
    [request.principal.workspace, namespace, id, Number(revision), after, Number(limit) + 1]);
    const items = result.rows.slice(0, Number(limit)).map(row => this.view(row, request.principal.workspace, locale));
    return { locale, pagination: 'live_committed_view', items, next_cursor: result.rows.length > Number(limit) ? items.at(-1)!.assessment.run_id : null };
  }
  private view(row: { snapshot: unknown; snapshot_sha256: string; run_id: string; namespace: string; transaction_id: string; revision_number: number }, workspace: string, locale: 'lo' | 'en') {
    const frozen = validateFrozenTransactionRisk(row.snapshot, row.snapshot_sha256), result = frozen.result;
    if (result.workspace_key !== workspace || result.run_id !== row.run_id || result.target.namespace !== row.namespace
      || result.target.transaction_id !== row.transaction_id || result.target.revision_number !== row.revision_number) throw new RiskError('RISK_STORAGE_UNAVAILABLE');
    return { locale, core_sha256: riskHash(result), assessment: localizeRiskResult(result, locale) };
  }
}
