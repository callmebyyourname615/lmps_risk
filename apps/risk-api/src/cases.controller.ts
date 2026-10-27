import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Inject,
  OnApplicationShutdown,
  Param,
  Post,
  Query,
  Req,
  Res,
  SetMetadata,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  listLocalCases,
  readLocalCase,
  readCaseHistory,
  type CaseQuery,
  type Database,
  type createLocalCases,
} from '@lmps/database';
import {
  CaseError,
  caseIdentity,
  caseMessage,
  selectRiskLocale,
  validateCaseCommand,
  type CaseCommand,
  riskMessage,
} from '@lmps/risk';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';
export const LOCAL_CASES = Symbol('LOCAL_CASES');
const statuses: Record<string, number> = {
  CASE_INVALID_INPUT: 400,
  CASE_NOT_FOUND: 404,
  CASE_ALERT_NOT_FOUND: 404,
  CASE_CONFLICT: 409,
  CASE_ALERT_ALREADY_LINKED: 409,
  CASE_INVALID_TRANSITION: 409,
  CASE_NOT_ASSIGNEE: 403,
  CASE_OUTCOME_REQUIRED: 409,
  CASE_LIMIT_REACHED: 409,
  CASE_STORAGE_UNAVAILABLE: 503,
  CASE_WRITES_NOT_CONFIGURED: 503,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
};
@Catch()
export class CaseResponseFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp(),
      request = http.getRequest<ScopedRequest>(),
      reply = http.getResponse<FastifyReply>(),
      locale = selectRiskLocale(request.headers['accept-language']);
    const body = error instanceof HttpException ? error.getResponse() : null;
    const proposed =
      error instanceof CaseError
        ? error.code
        : body && typeof body === 'object' && 'code' in body
          ? String(body.code)
          : '';
    const code = Object.hasOwn(statuses, proposed) ? proposed : 'CASE_STORAGE_UNAVAILABLE';
    reply
      .header('Content-Language', locale)
      .header('Vary', 'Accept-Language')
      .header('Cache-Control', 'no-store')
      .status(statuses[code]!)
      .send({
        code,
        locale,
        message: ['UNAUTHORIZED', 'FORBIDDEN'].includes(code) ? riskMessage(code, locale) : caseMessage(code, locale),
      });
  }
}
const invalid = (): never => {
  throw new CaseError('CASE_INVALID_INPUT');
};
const noQuery = (query: Record<string, unknown>) => {
  if (Object.keys(query).length) invalid();
};
function page(query: Record<string, unknown>) {
  const limit = query.limit ?? '5';
  if (typeof limit !== 'string' || !/^[1-9]\d?$/.test(limit) || Number(limit) > 10) invalid();
  return Number(limit);
}
@ApiTags('local-cases')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'cases:read')
@UseFilters(CaseResponseFilter)
@ApiResponse({ status: 400, description: 'CASE_INVALID_INPUT; localized and redacted' })
@ApiResponse({ status: 403, description: 'Missing scope or assigned reviewer' })
@ApiResponse({ status: 409, description: 'Case version, link, transition or idempotency conflict' })
@ApiResponse({ status: 503, description: 'Case storage unavailable/unconfigured' })
@Controller('v1/local/cases')
export class CasesController implements OnApplicationShutdown {
  constructor(
    @Inject(POSTGRES_DATABASE) private readonly database: Database,
    @Inject(LOCAL_CASES) private readonly writer: ReturnType<typeof createLocalCases> | null,
  ) {}
  async onApplicationShutdown() {
    await this.writer?.close();
  }
  private locale(request: ScopedRequest, reply: FastifyReply) {
    const locale = selectRiskLocale(request.headers['accept-language']);
    reply.header('Content-Language', locale).header('Vary', 'Accept-Language');
    return locale;
  }
  @Get()
  @ApiOperation({ summary: 'Read bounded case metadata/current analyst opinion; live UUID pagination' })
  async list(
    @Req() request: ScopedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() query: Record<string, unknown>,
  ) {
    if (
      Object.keys(query).some((k) => !['after', 'limit', 'state', 'assignee'].includes(k)) ||
      Object.values(query).some((v) => typeof v !== 'string')
    )
      invalid();
    const filter: CaseQuery = { limit: page(query) };
    if (query.after !== undefined) filter.after = query.after as string;
    if (query.state !== undefined) filter.state = query.state as string;
    if (query.assignee !== undefined) filter.assignee = query.assignee as string;
    return {
      locale: this.locale(request, reply),
      ...(await listLocalCases(this.database.pool, request.principal.workspace, filter)),
    };
  }
  @Get(':case_id')
  @ApiOperation({ summary: 'Read case metadata and effective analyst outcomes; no inferred training labels' })
  async detail(
    @Req() request: ScopedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('case_id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    noQuery(query);
    return {
      locale: this.locale(request, reply),
      case: await readLocalCase(this.database.pool, request.principal.workspace, id),
    };
  }
  private async history(
    kind: 'events' | 'outcomes' | 'evidence',
    r: ScopedRequest,
    s: FastifyReply,
    id: string,
    q: Record<string, unknown>,
  ) {
    if (
      Object.keys(q).some((k) => !['after', 'limit'].includes(k)) ||
      Object.values(q).some((v) => typeof v !== 'string')
    )
      invalid();
    const after = q.after ?? '0';
    if (typeof after !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(after) || Number(after) > 1000) invalid();
    return {
      locale: this.locale(r, s),
      ...(await readCaseHistory(this.database.pool, r.principal.workspace, id, kind, Number(after), page(q))),
    };
  }
  @Get(':case_id/events')
  @SetMetadata(LOCAL_SCOPE, ['cases:read', 'audit:read'])
  @ApiOperation({ summary: 'Read append-only case audit/notes in bounded version order' })
  events(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Query() q: Record<string, unknown>,
  ) {
    return this.history('events', r, s, id, q);
  }
  @Get(':case_id/outcomes')
  @ApiOperation({
    summary: 'Read versioned outcomes, including superseded/reopened reviews; training_eligible stays false',
  })
  outcomes(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Query() q: Record<string, unknown>,
  ) {
    return this.history('outcomes', r, s, id, q);
  }
  @Get(':case_id/evidence')
  @SetMetadata(LOCAL_SCOPE, ['cases:read', 'alerts:read', 'risk:read'])
  @ApiOperation({ summary: 'Read and verify frozen linked Alert, risk-policy and transaction revision references' })
  evidence(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Query() q: Record<string, unknown>,
  ) {
    return this.history('evidence', r, s, id, q);
  }
  private async write(
    action: CaseCommand['action'],
    r: ScopedRequest,
    s: FastifyReply,
    id: string,
    body: unknown,
    q: Record<string, unknown>,
  ) {
    noQuery(q);
    caseIdentity(r.principal.workspace, id);
    const command = validateCaseCommand(body);
    if (command.action !== action) invalid();
    const locale = this.locale(r, s);
    if (!this.writer) throw new CaseError('CASE_WRITES_NOT_CONFIGURED');
    return { locale, ...(await this.writer.command(r.principal.workspace, id, r.principal.subject, command)) };
  }
  @Post(':case_id/create')
  @SetMetadata(LOCAL_SCOPE, ['cases:read', 'cases:write', 'alerts:read', 'risk:read'])
  @ApiOperation({ summary: 'Create a case with one validated Alert; opening does not acknowledge it' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['action', 'request_id', 'expected_version', 'note', 'title', 'alert_id'],
      additionalProperties: false,
      properties: {
        action: { enum: ['create'] },
        request_id: { type: 'string', format: 'uuid' },
        expected_version: { type: 'integer', enum: [0] },
        note: { type: 'string', minLength: 1, maxLength: 2000 },
        title: { type: 'string', minLength: 1, maxLength: 120 },
        alert_id: { type: 'string', format: 'uuid' },
      },
    },
  })
  create(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('create', r, s, id, b, q);
  }
  @Post(':case_id/alerts')
  @SetMetadata(LOCAL_SCOPE, ['cases:read', 'cases:write', 'alerts:read', 'risk:read'])
  link(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('link_alert', r, s, id, b, q);
  }
  @Post(':case_id/assignment')
  @SetMetadata(LOCAL_SCOPE, ['cases:read', 'cases:assign'])
  assign(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('assign', r, s, id, b, q);
  }
  @Post(':case_id/start')
  @SetMetadata(LOCAL_SCOPE, ['cases:read', 'cases:work'])
  start(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('start', r, s, id, b, q);
  }
  @Post(':case_id/notes')
  @SetMetadata(LOCAL_SCOPE, ['cases:read', 'cases:work'])
  note(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('add_note', r, s, id, b, q);
  }
  @Post(':case_id/outcomes')
  @SetMetadata(LOCAL_SCOPE, ['cases:read', 'cases:work'])
  record(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('record_outcome', r, s, id, b, q);
  }
  @Post(':case_id/close')
  @SetMetadata(LOCAL_SCOPE, ['cases:read', 'cases:work'])
  close(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('close', r, s, id, b, q);
  }
  @Post(':case_id/reopen')
  @SetMetadata(LOCAL_SCOPE, ['cases:read', 'cases:reopen'])
  reopen(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Param('case_id') id: string,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('reopen', r, s, id, b, q);
  }
}
