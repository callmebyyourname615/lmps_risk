import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Database } from "@lmps/database";
import {
  LOCAL_SCOPE,
  LocalAccessGuard,
  type ScopedRequest,
} from "./local-auth.js";
import { POSTGRES_DATABASE } from "./postgres.service.js";

import {
  DEFAULT_NOTIFICATION_SETTINGS as DEFAULT,
  validNotificationPreferences,
  object,
  exact,
} from "./notification-settings.js";
import { WEB_PUSH, type WebPushRuntime } from "./web-push-runtime.js";
export { validNotificationPreferences } from "./notification-settings.js";
@ApiTags("local-notification-preferences")
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, "alerts:read")
@Controller("v1/local/user-notification-preferences")
export class NotificationPreferencesController {
  constructor(
    @Inject(POSTGRES_DATABASE) private readonly database: Database,
    @Inject(WEB_PUSH) private readonly push: WebPushRuntime,
  ) {}
  private view(request: ScopedRequest, row?: Record<string, unknown>) {
    if (
      row &&
      (!validNotificationPreferences(row.settings) ||
        !Number.isInteger(row.version))
    )
      throw new Error();
    return {
      workspace_key: request.principal.workspace,
      subject: request.principal.subject,
      version: row?.version ?? 0,
      settings: row?.settings ?? structuredClone(DEFAULT),
      push: this.push.status(),
      provenance: "local_synthetic",
      execution_mode: "test",
    };
  }
  @Get()
  @ApiOperation({
    summary:
      "Read personal notification delivery preferences; provider configuration is separate from saved settings",
  })
  async read(
    @Req() request: ScopedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    if (Object.keys(query).length)
      throw new BadRequestException({ code: "INVALID_NOTIFICATION_INPUT" });
    try {
      const row = (
        await this.database.pool.query(
          "SELECT version,settings FROM platform.local_notification_preferences WHERE workspace_key=$1 AND subject=$2",
          [request.principal.workspace, request.principal.subject],
        )
      ).rows[0];
      return this.view(request, row);
    } catch {
      throw new ServiceUnavailableException({
        code: "NOTIFICATION_PREFERENCES_UNAVAILABLE",
      });
    }
  }
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Save only this authenticated user’s preferences with optimistic concurrency; does not send or acknowledge Alerts",
  })
  async save(
    @Req() request: ScopedRequest,
    @Query() query: Record<string, unknown>,
    @Body() input: unknown,
  ) {
    if (
      Object.keys(query).length ||
      !object(input) ||
      !exact(input, ["expected_version", "settings"]) ||
      !Number.isInteger(input.expected_version) ||
      Number(input.expected_version) < 0 ||
      Number(input.expected_version) > 2147483646 ||
      !validNotificationPreferences(input.settings)
    )
      throw new BadRequestException({ code: "INVALID_NOTIFICATION_INPUT" });
    let row;
    try {
      row = (
        await this.database.pool.query(
          "SELECT version,settings FROM platform.save_notification_preferences($1,$2,$3,$4::jsonb)",
          [
            request.principal.workspace,
            request.principal.subject,
            input.expected_version,
            JSON.stringify(input.settings),
          ],
        )
      ).rows[0];
    } catch {
      throw new ServiceUnavailableException({
        code: "NOTIFICATION_PREFERENCES_UNAVAILABLE",
      });
    }
    if (!row)
      throw new ConflictException({
        code: "NOTIFICATION_PREFERENCES_CONFLICT",
      });
    return this.view(request, row);
  }
}
