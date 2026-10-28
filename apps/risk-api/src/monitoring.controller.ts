import { BadRequestException, Controller, Get, Inject, Param, Query, Req, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { parseMonitoringFilters, parseMonitoringRecordsQuery, type MonitoringSummary } from '@lmps/contracts/monitoring';
import { readMonitoringSummary, readMonitoringSnapshot, MonitoringReadError, type Database } from '@lmps/database';
import { RISK_CODES, localizeRiskResult, selectRiskLocale, riskHash } from '@lmps/risk';
import { parseTimelineTarget } from '@lmps/contracts/monitoring-timeline';
import { readMonitoringTimeline } from '@lmps/database';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';
import { MonitoringSnapshots } from './monitoring-snapshots.js';
import { parseNetworkQuery } from '@lmps/contracts/monitoring-network';

@ApiTags('local-monitoring')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, ['transactions:read', 'risk:read', 'alerts:read'])
@Controller('v1/local/monitoring')
export class MonitoringController {
  private readonly snapshots = new MonitoringSnapshots();
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}
  @Get('timeline')
  @ApiOperation({ summary: 'Read bounded full transaction revision, assessment and alert history in one repeatable-read; no inferred account linkage or payment ordering.' })
  async timeline(@Req() request: ScopedRequest, @Query() input: Record<string, unknown>) {
    let target; try { target = parseTimelineTarget(input); } catch { throw new BadRequestException({ code: 'MONITORING_INVALID_QUERY' }); }
    try {
      const core = await readMonitoringTimeline(this.database.pool, request.principal.workspace, target), locale = selectRiskLocale(request.headers['accept-language']);
      const response = { ...core, locale, core_sha256: riskHash(core), assessments: core.assessments.map(row => ({ ...row, result: localizeRiskResult(row.result, locale) })) };
      if (Buffer.byteLength(JSON.stringify(response)) > 2 * 1024 * 1024) throw new MonitoringReadError('MONITORING_SCOPE_TOO_LARGE');
      return response;
    } catch (error) { return this.unavailable(error); }
  }
  @Get('feed')
  @ApiOperation({ summary: 'Read bounded latest transaction revisions, assessments and alerts for polling; no cache allocation, event-log completeness or source-connectivity claim.' })
  async feed(@Req() request: ScopedRequest, @Query() input: Record<string, unknown>) {
    const filters = this.filters(input);
    try {
      const snapshot = await readMonitoringSnapshot(this.database.pool, request.principal.workspace, filters);
      const result = { version: 'local-monitoring-feed-1' as const, summary: snapshot.summary, rows: [...snapshot.transactions, ...snapshot.alerts] };
      if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new MonitoringReadError('MONITORING_SCOPE_TOO_LARGE');
      return result;
    } catch (error) { return this.unavailable(error); }
  }
  @Get('snapshots')
  @ApiOperation({ summary: 'Capture bounded read-only monitoring evidence for five minutes; principal-bound transient snapshot, no database writes.' })
  async createSnapshot(@Req() request: ScopedRequest, @Query() input: Record<string, unknown>) {
    const filters = this.filters(input);
    try { return this.snapshots.create(request.principal, await readMonitoringSnapshot(this.database.pool, request.principal.workspace, filters)); }
    catch (error) { return this.unavailable(error); }
  }
  @Get('snapshots/:id')
  @ApiOperation({ summary: 'Read the original snapshot summary; expired/evicted/restarted contexts return410 rather than refreshed counts.' })
  snapshot(@Req() request: ScopedRequest, @Param('id') id: string, @Query() input: Record<string, unknown>) {
    if (Object.keys(input).length) throw new BadRequestException({ code: 'MONITORING_INVALID_QUERY' });
    return this.snapshots.session(request.principal, id);
  }
  @Get('snapshots/:id/records')
  @ApiOperation({ summary: 'Search, sort and paginate the exact snapshot subset underlying a KPI; cursors bind all query parameters.' })
  records(@Req() request: ScopedRequest, @Param('id') id: string, @Query() input: Record<string, unknown>) {
    let query; try { query = parseMonitoringRecordsQuery(input); } catch { throw new BadRequestException({ code: 'MONITORING_INVALID_QUERY' }); }
    return this.snapshots.page(request.principal, id, query);
  }
  @Get('snapshots/:id/evidence')
  @ApiOperation({ summary: 'Read pinned revision/assessment references and provenance without raw account inputs or a Case.' })
  evidence(@Req() request: ScopedRequest, @Param('id') id: string, @Query() input: Record<string, unknown>) {
    if (Object.keys(input).join(',') !== 'record' || typeof input.record !== 'string') throw new BadRequestException({ code: 'MONITORING_INVALID_QUERY' });
    return this.snapshots.evidence(request.principal, id, input.record);
  }
  @Get('snapshots/:id/network')
  @ApiOperation({ summary: 'Read bounded synthetic-only directed flow from the same frozen revisions as monitoring records; unresolved identities are never linked.' })
  network(@Req() request: ScopedRequest, @Param('id') id: string, @Query() input: Record<string, unknown>) {
    let query; try { query = parseNetworkQuery(input); } catch { throw new BadRequestException({ code: 'MONITORING_INVALID_QUERY' }); }
    return this.snapshots.network(request.principal, id, query);
  }
  @Get('snapshots/:id/trends')
  @ApiOperation({ summary: 'Read bounded latest revisions and Alerts from the original monitoring snapshot for recorded-time heatmaps and trends; no historical risk-state or payment-time claim.' })
  trends(@Req() request: ScopedRequest, @Param('id') id: string, @Query() input: Record<string, unknown>) {
    if (Object.keys(input).length) throw new BadRequestException({ code: 'MONITORING_INVALID_QUERY' });
    try { return this.snapshots.trends(request.principal, id); }
    catch (error) { if (error instanceof MonitoringReadError) return this.unavailable(error); throw error; }
  }
  private filters(input: Record<string, unknown>) {
    try { const value = parseMonitoringFilters(input); if (value.pattern !== null && !RISK_CODES.includes(value.pattern as typeof RISK_CODES[number])) throw new Error(); return value; }
    catch { throw new BadRequestException({ code: 'MONITORING_INVALID_QUERY', message: 'Invalid monitoring filters.' }); }
  }
  private unavailable(error: unknown): never {
    const code = error instanceof MonitoringReadError ? error.code : 'MONITORING_UNAVAILABLE';
    throw new ServiceUnavailableException({ code, message: code === 'MONITORING_SCOPE_TOO_LARGE' ? 'Narrow the monitoring scope; no partial totals were returned.' : 'Monitoring data is unavailable.' });
  }
  @Get('summary')
  @ApiOperation({ summary: 'Bounded current-revision monitoring snapshot; no Case/Reviewer scope, source freshness inference or payment effects.' })
  @ApiResponse({ status: 200, description: 'Monitoring v1: applied filters, current-revision counts, assessment availability, overlapping risk dimensions and currency-separated counts.' })
  @ApiResponse({ status: 400, description: 'MONITORING_INVALID_QUERY; tenant, historical as_of and institution overrides are rejected.' })
  @ApiResponse({ status: 503, description: 'MONITORING_UNAVAILABLE or MONITORING_SCOPE_TOO_LARGE; no partial totals.' })
  async summary(@Req() request: ScopedRequest, @Query() input: Record<string, unknown>): Promise<MonitoringSummary> {
    let filters;
    try {
      filters = parseMonitoringFilters(input);
      if (filters.pattern !== null && !RISK_CODES.includes(filters.pattern as typeof RISK_CODES[number])) throw new Error();
    } catch { throw new BadRequestException({ code: 'MONITORING_INVALID_QUERY', message: 'Invalid monitoring filters.' }); }
    try { return await readMonitoringSummary(this.database.pool, request.principal.workspace, filters); }
    catch (error) {
      const code = error instanceof MonitoringReadError ? error.code : 'MONITORING_UNAVAILABLE';
      throw new ServiceUnavailableException({ code, message: code === 'MONITORING_SCOPE_TOO_LARGE' ? 'Narrow the monitoring scope; no partial totals were returned.' : 'Monitoring data is unavailable.' });
    }
  }
}
