import { BadRequestException, Controller, Get, Inject, Param, Query, Req, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { validateAssessmentReport, validateRuleVersion, type BacktestReport, type Database, type SyntheticRule } from '@lmps/database';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

class RuleVersionView {
  @ApiProperty() rule_version!: string;
  @ApiProperty() rule_sha256!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Validated synthetic amount_gte definition; registration is not production approval/activation.' }) definition!: SyntheticRule;
}
class RuleVersionPage {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty() workspace_key!: string;
  @ApiProperty() rule_id!: string;
  @ApiProperty({ enum: ['live_committed_view'] }) pagination!: 'live_committed_view';
  @ApiProperty({ type: [RuleVersionView] }) items!: RuleVersionView[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
class AssessmentSummary {
  @ApiProperty({ format: 'uuid' }) run_id!: string;
  @ApiProperty({ enum: ['partial', 'complete'] }) status!: 'partial' | 'complete';
  @ApiProperty() report_sha256!: string;
  @ApiProperty() manifest_sha256!: string;
  @ApiProperty() input_set_sha256!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) counts!: BacktestReport['counts'];
}
class AssessmentPage {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty({ enum: [false] }) enforcement!: false;
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ enum: ['live_committed_view'] }) pagination!: 'live_committed_view';
  @ApiProperty({ type: [AssessmentSummary] }) items!: AssessmentSummary[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
class AssessmentDetail {
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true, description: 'Validated immutable synthetic BacktestReport, or null for unknown/foreign run. Includes explicit revision targets, frozen rules/reasons, unavailable markers and fingerprints. Not a payment decision.' }) report!: BacktestReport | null;
  @ApiProperty({ type: String, nullable: true }) report_sha256!: string | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const version = /^synthetic_[A-Za-z0-9_.:-]{1,70}$/;
const invalid = () => new BadRequestException({ code: 'INVALID_QUERY', message: 'Invalid local rules/assessment query.' });

@ApiTags('local-rules-assessments')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@ApiResponse({ status: 400, description: 'INVALID_QUERY' })
@ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN' })
@ApiResponse({ status: 503, description: 'RULES_UNAVAILABLE or ASSESSMENTS_UNAVAILABLE; fixed redacted errors' })
@Controller('v1/local')
export class AssessmentsController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}

  @Get('rules/:rule_id/versions')
  @SetMetadata(LOCAL_SCOPE, 'rules:read')
  @ApiOperation({ summary: 'Read immutable synthetic rule versions, ordered lexically by version (not effective date)' })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiOkResponse({ type: RuleVersionPage })
  async rules(@Req() request: ScopedRequest, @Param('rule_id') ruleId: string, @Query() query: Record<string, unknown>): Promise<RuleVersionPage> {
    const { after, limit } = this.page(query, 25, 100);
    if (!/^synthetic_[a-z0-9_]{1,60}$/.test(ruleId) || (after !== '' && !version.test(after))) throw invalid();
    try {
      const result = await this.database.pool.query(`SELECT rule_version,definition,rule_sha256 FROM platform.local_rule_versions
        WHERE workspace_key=$1 AND rule_id=$2 AND rule_version>$3 ORDER BY rule_version LIMIT $4`,
      [request.principal.workspace, ruleId, after, limit + 1]);
      const items = result.rows.slice(0, limit).map(row => {
        const definition = validateRuleVersion(row.definition, row.rule_sha256);
        if (definition.rule_id !== ruleId || definition.rule_version !== row.rule_version) throw new Error();
        return { rule_version: row.rule_version, rule_sha256: row.rule_sha256, definition };
      });
      return { provenance: 'local_synthetic', execution_mode: 'test', workspace_key: request.principal.workspace, rule_id: ruleId,
        pagination: 'live_committed_view', items, next_cursor: result.rows.length > limit ? items.at(-1)!.rule_version : null };
    } catch { throw new ServiceUnavailableException({ code: 'RULES_UNAVAILABLE', message: 'Local rule versions are unavailable.' }); }
  }

  @Get('assessments')
  @SetMetadata(LOCAL_SCOPE, 'assessments:read')
  @ApiOperation({ summary: 'Read bounded synthetic run summaries, ordered by run UUID (not time)' })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 10 })
  @ApiOkResponse({ type: AssessmentPage })
  async assessments(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>): Promise<AssessmentPage> {
    const { after, limit } = this.page(query, 5, 10);
    if (after !== '' && !uuid.test(after)) throw invalid();
    const rows = await this.readReports(request.principal.workspace, after, limit + 1, false);
    const items = rows.slice(0, limit).map(({ report, digest }) => ({ run_id: report.run_id, status: report.status, report_sha256: digest,
      manifest_sha256: report.manifest_sha256, input_set_sha256: report.input_set_sha256, counts: report.counts }));
    return { provenance: 'local_synthetic', execution_mode: 'test', enforcement: false, workspace_key: request.principal.workspace,
      pagination: 'live_committed_view', items, next_cursor: rows.length > limit ? items.at(-1)!.run_id : null };
  }

  @Get('assessments/:run_id')
  @SetMetadata(LOCAL_SCOPE, 'assessments:read')
  @ApiOperation({ summary: 'Read frozen assessment evidence without re-evaluating current transactions' })
  @ApiOkResponse({ type: AssessmentDetail })
  async assessment(@Req() request: ScopedRequest, @Param('run_id') id: string, @Query() query: Record<string, unknown>): Promise<AssessmentDetail> {
    if (!uuid.test(id) || Object.keys(query).length) throw invalid();
    const row = (await this.readReports(request.principal.workspace, id, 1, true))[0];
    return { report: row?.report ?? null, report_sha256: row?.digest ?? null };
  }

  private page(query: Record<string, unknown>, fallback: number, maximum: number) {
    const after = query.after ?? '', limit = query.limit ?? String(fallback);
    if (Object.keys(query).some(key => !['after', 'limit'].includes(key)) || typeof after !== 'string'
      || (Object.hasOwn(query, 'after') && after === '') || typeof limit !== 'string' || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > maximum) throw invalid();
    return { after, limit: Number(limit) };
  }

  private async readReports(workspace: string, cursor: string, limit: number, detail: boolean) {
    try {
      const result = await this.database.pool.query(`SELECT run_id::text,report,report_sha256 FROM platform.local_assessment_runs
        WHERE workspace_key=$1 AND ${detail ? 'run_id=$2::uuid' : 'run_id>COALESCE($2::uuid,\'00000000-0000-0000-0000-000000000000\'::uuid)'}
        ORDER BY run_id LIMIT $3`, [workspace, cursor || null, limit]);
      return result.rows.map(row => {
        const report = validateAssessmentReport(row.report, row.report_sha256);
        if (report.workspace_key !== workspace || report.run_id !== row.run_id) throw new Error();
        return { report, digest: row.report_sha256 as string };
      });
    } catch { throw new ServiceUnavailableException({ code: 'ASSESSMENTS_UNAVAILABLE', message: 'Local assessments are unavailable.' }); }
  }
}
