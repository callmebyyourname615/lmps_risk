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
  Post,
  Param,
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
  compareStoredRiskPolicies,
  listRiskPolicies,
  readRiskPolicy,
  readPolicyBinding,
  type createRiskPolicies,
  type Database,
} from '@lmps/database';
import type { PolicyCommand } from '@lmps/risk';
import { PolicyError, policyRef, POLICY_NAMESPACE, selectRiskLocale, validatePolicyCommand } from '@lmps/risk';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

export const RISK_POLICIES = Symbol('RISK_POLICIES');
const statuses: Record<string, number> = {
  POLICY_INVALID_INPUT: 400,
  POLICY_NOT_FOUND: 404,
  POLICY_CONFLICT: 409,
  POLICY_INVALID_TRANSITION: 409,
  POLICY_SELF_APPROVAL: 403,
  POLICY_NOT_APPROVED: 409,
  POLICY_STORAGE_UNAVAILABLE: 503,
  POLICY_WRITES_NOT_CONFIGURED: 503,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
};
export const policyMessage = (code: string, locale: string) =>
  locale === 'lo'
    ? ({
        POLICY_INVALID_INPUT: 'ຂໍ້ມູນນະໂຍບາຍບໍ່ຖືກຕ້ອງ',
        POLICY_NOT_FOUND: 'ບໍ່ພົບນະໂຍບາຍ',
        POLICY_CONFLICT: 'ນະໂຍບາຍມີການປ່ຽນແປງ ກະລຸນາໂຫຼດໃໝ່',
        POLICY_SELF_APPROVAL: 'ຜູ້ສ້າງຫຼືຜູ້ສົ່ງບໍ່ສາມາດອະນຸມັດເອງໄດ້',
        UNAUTHORIZED: 'ຕ້ອງມີໂທເຄັນທີ່ຖືກຕ້ອງ',
        FORBIDDEN: 'ບໍ່ມີສິດສຳລັບການດຳເນີນການນີ້',
      }[code] ?? 'ບໍ່ສາມາດດຳເນີນການນະໂຍບາຍໄດ້')
    : ({
        POLICY_INVALID_INPUT: 'Invalid policy input.',
        POLICY_NOT_FOUND: 'Policy or evidence not found.',
        POLICY_CONFLICT: 'Policy changed or request conflicts; refresh before retrying.',
        POLICY_INVALID_TRANSITION: 'Policy transition is not allowed.',
        POLICY_SELF_APPROVAL: 'Creator or submitter cannot approve or reject their own policy.',
        POLICY_NOT_APPROVED: 'Policy is not approved.',
        POLICY_WRITES_NOT_CONFIGURED: 'Policy write storage is not configured.',
        UNAUTHORIZED: 'A valid local access token is required.',
        FORBIDDEN: 'Required policy scope is unavailable.',
      }[code] ?? 'Policy storage is unavailable.');
@Catch()
export class PolicyResponseFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp(),
      request = http.getRequest<ScopedRequest>(),
      reply = http.getResponse<FastifyReply>(),
      locale = selectRiskLocale(request.headers['accept-language']);
    const body = error instanceof HttpException ? error.getResponse() : null;
    const proposed =
      error instanceof PolicyError
        ? error.code
        : body && typeof body === 'object' && 'code' in body
          ? String(body.code)
          : '';
    const code = Object.hasOwn(statuses, proposed) ? proposed : 'POLICY_STORAGE_UNAVAILABLE';
    reply
      .header('Content-Language', locale)
      .header('Vary', 'Accept-Language')
      .header('Cache-Control', 'no-store')
      .status(statuses[code]!)
      .send({ code, locale, message: policyMessage(code, locale) });
  }
}
function invalid(): never {
  throw new PolicyError('POLICY_INVALID_INPUT');
}
const emptyQuery = (query: Record<string, unknown>) => {
  if (Object.keys(query).length) invalid();
};
function page(query: Record<string, unknown>) {
  if (
    Object.keys(query).some((k) => !['after', 'limit'].includes(k)) ||
    Object.values(query).some((v) => typeof v !== 'string')
  )
    invalid();
  const limit = query.limit ?? '5';
  if (typeof limit !== 'string' || !/^[1-9]\d?$/.test(limit) || Number(limit) > 10) invalid();
  return Number(limit);
}
@ApiTags('local-risk-policies')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'policies:read')
@UseFilters(PolicyResponseFilter)
@ApiResponse({ status: 400, description: 'POLICY_INVALID_INPUT' })
@ApiResponse({ status: 409, description: 'Version, idempotency or activation conflict' })
@ApiResponse({ status: 503, description: 'Storage unavailable; redacted' })
@Controller('v1/local/risk-policies')
export class RiskPoliciesController implements OnApplicationShutdown {
  constructor(
    @Inject(POSTGRES_DATABASE) private readonly database: Database,
    @Inject(RISK_POLICIES) private readonly writer: ReturnType<typeof createRiskPolicies> | null,
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
  @ApiOperation({ summary: 'List local policy versions, bounded live lexical pagination' })
  async list(
    @Req() request: ScopedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() query: Record<string, unknown>,
  ) {
    const limit = page(query);
    let after: [string, string] | null = null;
    if (query.after !== undefined) {
      try {
        if (typeof query.after !== 'string' || query.after.length > 512 || !/^[A-Za-z0-9_-]+$/.test(query.after))
          invalid();
        const parsed = JSON.parse(Buffer.from(query.after as string, 'base64url').toString());
        if (!Array.isArray(parsed) || parsed.length !== 2) invalid();
        policyRef({ policy_id: parsed[0], policy_version: parsed[1] });
        after = parsed as [string, string];
      } catch {
        invalid();
      }
    }
    return {
      locale: this.locale(request, reply),
      ...(await listRiskPolicies(this.database.pool, request.principal.workspace, after, limit)),
    };
  }
  @Get('binding/:namespace/:currency')
  @ApiOperation({ summary: 'Read explicit active binding; no production default' })
  async binding(
    @Req() request: ScopedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('namespace') namespace: string,
    @Param('currency') currency: string,
    @Query() query: Record<string, unknown>,
  ) {
    emptyQuery(query);
    if (!POLICY_NAMESPACE.test(namespace) || !/^[A-Z]{3}$/.test(currency)) invalid();
    return {
      locale: this.locale(request, reply),
      binding: await readPolicyBinding(this.database.pool, request.principal.workspace, namespace, currency),
    };
  }
  @Get('events')
  @SetMetadata(LOCAL_SCOPE, ['policies:read', 'audit:read'])
  @ApiOperation({ summary: 'Read protected policy action history, UUID pagination; not an incremental feed' })
  async events(
    @Req() request: ScopedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() query: Record<string, unknown>,
  ) {
    const limit = page(query),
      after = query.after ?? null;
    if (
      after !== null &&
      (typeof after !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(after))
    )
      invalid();
    const rows = (
      await this.database.pool.query(
        `SELECT request_id::text,actor_subject,action,command->>'note' AS note,result,occurred_at FROM platform.local_risk_policy_events WHERE workspace_key=$1 AND request_id>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY request_id LIMIT $3`,
        [request.principal.workspace, after, limit + 1],
      )
    ).rows;
    return {
      locale: this.locale(request, reply),
      pagination: 'live_committed_view',
      items: rows.slice(0, limit),
      next_cursor: rows.length > limit ? rows[limit - 1].request_id : null,
    };
  }
  @Get(':policy_id/versions/:policy_version')
  @ApiOperation({ summary: 'Read immutable policy content and governance state' })
  async detail(
    @Req() request: ScopedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('policy_id') policy_id: string,
    @Param('policy_version') policy_version: string,
    @Query() query: Record<string, unknown>,
  ) {
    emptyQuery(query);
    return {
      locale: this.locale(request, reply),
      policy: await readRiskPolicy(this.database.pool, request.principal.workspace, { policy_id, policy_version }),
    };
  }
  @Post('comparisons')
  @SetMetadata(LOCAL_SCOPE, ['policies:read', 'risk:read'])
  @ApiOperation({
    summary: 'Compare two policy versions on at most20 stored frozen runs; read-only simulation, no Alerts',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['baseline', 'candidate', 'run_ids'],
      additionalProperties: false,
      properties: {
        baseline: { type: 'object' },
        candidate: { type: 'object' },
        run_ids: { type: 'array', maxItems: 20, items: { type: 'string', format: 'uuid' } },
      },
    },
  })
  async compare(
    @Req() request: ScopedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
  ) {
    emptyQuery(query);
    const b = body as Record<string, unknown>;
    if (!b || Object.keys(b).sort().join() !== 'baseline,candidate,run_ids') invalid();
    for (const value of [b.baseline, b.candidate]) {
      if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== 'policy_id,policy_version')
        invalid();
    }
    return {
      locale: this.locale(request, reply),
      ...(await compareStoredRiskPolicies(
        this.database.pool,
        request.principal.workspace,
        b.baseline,
        b.candidate,
        b.run_ids,
      )),
    };
  }
  private async write(
    action: PolicyCommand['action'],
    request: ScopedRequest,
    reply: FastifyReply,
    body: unknown,
    query: Record<string, unknown>,
  ) {
    emptyQuery(query);
    const command = validatePolicyCommand(body);
    if (command.action !== action) invalid();
    const locale = this.locale(request, reply);
    if (!this.writer) throw new PolicyError('POLICY_WRITES_NOT_CONFIGURED');
    return { locale, ...(await this.writer.command(request.principal.workspace, request.principal.subject, command)) };
  }
  @Post('drafts')
  @SetMetadata(LOCAL_SCOPE, ['policies:read', 'policies:write'])
  draft(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('create', r, s, b, q);
  }
  @Post('submissions')
  @SetMetadata(LOCAL_SCOPE, ['policies:read', 'policies:write'])
  submit(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('submit', r, s, b, q);
  }
  @Post('approvals')
  @SetMetadata(LOCAL_SCOPE, ['policies:read', 'policies:approve'])
  approve(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('approve', r, s, b, q);
  }
  @Post('rejections')
  @SetMetadata(LOCAL_SCOPE, ['policies:read', 'policies:approve'])
  reject(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('reject', r, s, b, q);
  }
  @Post('activations')
  @SetMetadata(LOCAL_SCOPE, ['policies:read', 'policies:activate'])
  activate(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('activate', r, s, b, q);
  }
  @Post('rollbacks')
  @SetMetadata(LOCAL_SCOPE, ['policies:read', 'policies:activate'])
  rollback(
    @Req() r: ScopedRequest,
    @Res({ passthrough: true }) s: FastifyReply,
    @Body() b: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    return this.write('rollback', r, s, b, q);
  }
}
