import {
  BadRequestException,
  Controller,
  Get,
  Inject,
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
@ApiTags("local-alert-summary")
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, "alerts:read")
@Controller("v1/local/alerts/summary")
export class AlertSummaryController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}
  @Get()
  @ApiOperation({
    summary:
      "Workspace-wide committed Alert review-state counts, independent of loaded pages and filtered snapshots",
  })
  async read(
    @Req() request: ScopedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    if (Object.keys(query).length)
      throw new BadRequestException({ code: "INVALID_ALERT_QUERY" });
    try {
      const row = (
        await this.database.pool.query(
          `WITH states AS (
    SELECT a.alert_id,coalesce((SELECT max(r.version) FROM platform.local_alert_reviews r WHERE r.workspace_key=a.workspace_key AND r.alert_id=a.alert_id),0) AS version
    FROM platform.local_alerts a WHERE a.workspace_key=$1
   ) SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS as_of,
    count(*) FILTER(WHERE version=0)::text AS open,count(*) FILTER(WHERE version=1)::text AS acknowledged,count(*) FILTER(WHERE version=2)::text AS reviewed FROM states`,
          [request.principal.workspace],
        )
      ).rows[0];
      const counts = Object.fromEntries(
        ["open", "acknowledged", "reviewed"].map((key) => {
          const n = Number(row[key]);
          if (!Number.isSafeInteger(n) || n < 0) throw Error();
          return [key, n];
        }),
      );
      return {
        workspace_key: request.principal.workspace,
        as_of: row.as_of,
        scope: "workspace",
        metric: "alert_review_states",
        counts,
        provenance: "local_synthetic",
        execution_mode: "test",
      };
    } catch {
      throw new ServiceUnavailableException({
        code: "ALERT_SUMMARY_UNAVAILABLE",
      });
    }
  }
}
