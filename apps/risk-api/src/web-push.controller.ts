import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import type { Database } from "@lmps/database";
import {
  LOCAL_SCOPE,
  LocalAccessGuard,
  type ScopedRequest,
} from "./local-auth.js";
import { POSTGRES_DATABASE } from "./postgres.service.js";
import {
  WEB_PUSH,
  WebPushRuntime,
  endpointHash,
  sealSubscription,
  validDeviceSubscription,
} from "./web-push-runtime.js";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const invalid = () => new BadRequestException({ code: "INVALID_PUSH_INPUT" });
const unavailable = () =>
  new ServiceUnavailableException({ code: "WEB_PUSH_UNAVAILABLE" });
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const time = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
@ApiTags("web-push")
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, "alerts:read")
@Controller("v1/local/web-push")
export class WebPushController {
  constructor(
    @Inject(POSTGRES_DATABASE) private readonly database: Database,
    @Inject(WEB_PUSH) private readonly runtime: WebPushRuntime,
  ) {}
  private identity(request: ScopedRequest) {
    return {
      workspace_key: request.principal.workspace,
      subject: request.principal.subject,
    };
  }
  @Get()
  @ApiOperation({
    summary:
      "Personal device subscription metadata and public VAPID key; never returns endpoints or credentials",
  })
  async read(
    @Req() request: ScopedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    if (Object.keys(query).length) throw invalid();
    try {
      const items = (
        await this.database.pool.query(
          `SELECT subscription_id::text,endpoint_hash,active,${time("created_at")} AS created_at FROM platform.local_web_push_subscriptions WHERE workspace_key=$1 AND subject=$2 ORDER BY active DESC,created_at DESC LIMIT 100`,
          [request.principal.workspace, request.principal.subject],
        )
      ).rows;
      return {
        ...this.identity(request),
        ...this.runtime.status(),
        public_key: this.runtime.config?.publicKey ?? null,
        items,
        delivery_semantics: "push_service_acceptance_only",
      };
    } catch {
      throw unavailable();
    }
  }
  @Post("subscriptions")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Register a browser-consented subscription for this authenticated user; HTTPS provider allowlist and encrypted storage",
  })
  async register(
    @Req() request: ScopedRequest,
    @Query() query: Record<string, unknown>,
    @Body() input: unknown,
  ) {
    if (Object.keys(query).length || !validDeviceSubscription(input))
      throw invalid();
    const config = this.runtime.config;
    if (!config)
      throw new ServiceUnavailableException({
        code: "PUSH_PROVIDER_NOT_CONFIGURED",
      });
    const { workspace, subject } = request.principal,
      hash = endpointHash(input);
    let row;
    try {
      row = (
        await this.database.pool.query(
          "SELECT subscription_id::text,active FROM platform.save_web_push_subscription($1,$2,$3,$4,$5)",
          [
            workspace,
            subject,
            hash,
            sealSubscription(
              input,
              config,
              JSON.stringify([workspace, subject, hash]),
            ),
            randomUUID(),
          ],
        )
      ).rows[0];
    } catch {
      throw unavailable();
    }
    if (!row)
      throw new ConflictException({ code: "PUSH_SUBSCRIPTION_CONFLICT" });
    return { ...this.identity(request), ...row };
  }
  @Post("subscriptions/:id/revoke")
  @HttpCode(200)
  async revoke(
    @Req() request: ScopedRequest,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
    @Body() input: unknown,
  ) {
    if (
      !uuid.test(id) ||
      Object.keys(query).length ||
      !object(input) ||
      Object.keys(input).length
    )
      throw invalid();
    let result;
    try {
      result = (
        await this.database.pool.query(
          "SELECT platform.revoke_web_push_subscription($1,$2,$3) AS ok",
          [request.principal.workspace, request.principal.subject, id],
        )
      ).rows[0]?.ok;
    } catch {
      throw unavailable();
    }
    if (!result)
      throw new NotFoundException({ code: "PUSH_SUBSCRIPTION_NOT_FOUND" });
    return { ...this.identity(request), subscription_id: id, active: false };
  }
  @Post("subscriptions/:id/test")
  @HttpCode(200)
  async test(
    @Req() request: ScopedRequest,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
    @Body() input: unknown,
  ) {
    if (
      !uuid.test(id) ||
      Object.keys(query).length ||
      !object(input) ||
      Object.keys(input).length
    )
      throw invalid();
    if (!this.runtime.config)
      throw new ServiceUnavailableException({
        code: "PUSH_PROVIDER_NOT_CONFIGURED",
      });
    let value;
    try {
      value = (
        await this.database.pool.query(
          "SELECT platform.queue_web_push_test($1,$2,$3)::text AS id",
          [request.principal.workspace, request.principal.subject, id],
        )
      ).rows[0]?.id;
    } catch {
      throw unavailable();
    }
    if (!value) throw new ConflictException({ code: "PUSH_TEST_NOT_QUEUED" });
    return {
      ...this.identity(request),
      delivery_id: value,
      state: "pending",
      delivery_semantics: "push_service_acceptance_only",
    };
  }
  @Get("deliveries")
  @ApiOperation({
    summary:
      "This user’s durable Web Push attempts; accepted means accepted by push service, not proven device delivery",
  })
  async deliveries(
    @Req() request: ScopedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    if (
      Object.keys(query).some((k) => k !== "after") ||
      (query.after !== undefined &&
        (typeof query.after !== "string" || !uuid.test(query.after)))
    )
      throw invalid();
    try {
      const rows = (
        await this.database.pool.query(
          `SELECT delivery_id::text,kind,state,attempt_count,last_code,${time("created_at")} AS created_at,${time("updated_at")} AS updated_at FROM platform.local_web_push_deliveries WHERE workspace_key=$1 AND subject=$2 AND ($3::uuid IS NULL OR delivery_id>$3::uuid) ORDER BY delivery_id LIMIT 51`,
          [
            request.principal.workspace,
            request.principal.subject,
            query.after ?? null,
          ],
        )
      ).rows;
      const items = rows.slice(0, 50);
      return {
        ...this.identity(request),
        ...this.runtime.status(),
        provider: "web_push",
        delivery_semantics: "push_service_acceptance_only",
        items,
        next_cursor: rows.length > 50 ? items.at(-1)?.delivery_id : null,
      };
    } catch {
      throw unavailable();
    }
  }
}
