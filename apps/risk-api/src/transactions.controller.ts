import { BadRequestException, Controller, Get, Inject, Param, Query, Req, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { validateTransactionRevision, type Database, type LocalTransactionRevision } from '@lmps/database';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

class TransactionRevisionView {
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) revision_number!: number;
  @ApiProperty({ format: 'date-time' }) recorded_at!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Validated Transaction contract 0.1.0-draft.1, restricted to test mode with evidence-bound synthetic lifecycle or unknown status, unresolved accounts and unverified source mapping. Money and opaque IDs remain strings.' })
  payload!: LocalTransactionRevision['transaction'];
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true, description: 'First-publication synthetic source/evidence lineage, raw currency mapping and normalization input; null for older unknown observations. Not verified source semantics or a complete capture ledger.' })
  publication!: LocalTransactionRevision['publication'] | null;
}
class TransactionRevisionPage {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty({ enum: [false] }) canonical_emission!: false;
  @ApiProperty({ enum: ['unverified'] }) source_semantics!: 'unverified';
  @ApiProperty() workspace_key!: string;
  @ApiProperty() namespace!: string;
  @ApiProperty({ type: String }) transaction_id!: string;
  @ApiProperty({ enum: ['latest', 'history'] }) view!: 'latest' | 'history';
  @ApiProperty({ enum: ['live_committed_view'] }) pagination!: 'live_committed_view';
  @ApiProperty({ type: [TransactionRevisionView] }) items!: TransactionRevisionView[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
class TransactionListItem {
  @ApiProperty() namespace!: string;
  @ApiProperty() transaction_id!: string;
  @ApiProperty() revision_number!: number;
  @ApiProperty({ type: String, description: 'Exact decimal string; no cross-currency sum.' }) amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() transaction_status!: string;
  @ApiProperty({ description: 'Recorded observation time, not inferred payment occurrence time.' }) observed_at!: string;
  @ApiProperty() recorded_at!: string;
}
class TransactionListPage {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty({ enum: [false] }) canonical_emission!: false;
  @ApiProperty({ enum: ['unverified'] }) source_semantics!: 'unverified';
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ enum: ['live_committed_view_namespace_id_order'] }) pagination!: 'live_committed_view_namespace_id_order';
  @ApiProperty({ type: 'object', additionalProperties: true }) filters!: Record<'namespace' | 'q' | 'currency' | 'status', string | null>;
  @ApiProperty({ type: [TransactionListItem] }) items!: TransactionListItem[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
const NAMESPACE = /^synthetic_[a-z0-9_]{1,40}$/;
const TRANSACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATUSES = ['unknown', 'pending', 'succeeded', 'failed', 'reversed', 'partially_reversed'];
const invalidList = () => new BadRequestException({ code: 'INVALID_QUERY', message: 'Invalid local transaction list query.' });

@ApiTags('local-transactions')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'transactions:read')
@ApiResponse({ status: 400, description: 'INVALID_QUERY' })
@ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
@ApiResponse({ status: 403, description: 'FORBIDDEN' })
@ApiResponse({ status: 503, description: 'TRANSACTIONS_UNAVAILABLE' })
@Controller('v1/local/transactions')
export class TransactionsController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}

  @Get()
  @ApiOperation({ summary: 'List latest recorded revision per scoped namespace/Transaction ID; live keyset view, not a stable export or canonical payment inventory' })
  @ApiQuery({ name: 'namespace', required: false, type: String })
  @ApiQuery({ name: 'q', required: false, type: String, description: 'Case-sensitive literal Transaction ID prefix; leading zeros matter.' })
  @ApiQuery({ name: 'currency', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'after', required: false, type: String, description: 'Opaque cursor bound to workspace and the applied filters.' })
  @ApiOkResponse({ type: TransactionListPage })
  async list(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>): Promise<TransactionListPage> {
    const namespace = query.namespace ?? null, q = query.q ?? null, currency = query.currency ?? null, status = query.status ?? null;
    const limit = query.limit ?? '25';
    if (Object.keys(query).some(key => !['namespace', 'q', 'currency', 'status', 'limit', 'after'].includes(key))
      || !(namespace === null || typeof namespace === 'string' && NAMESPACE.test(namespace))
      || !(q === null || typeof q === 'string' && TRANSACTION_ID.test(q))
      || !(currency === null || typeof currency === 'string' && /^[A-Z]{3}$/.test(currency))
      || !(status === null || typeof status === 'string' && STATUSES.includes(status))
      || typeof limit !== 'string' || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100) throw invalidList();
    const filters = { namespace, q, currency, status } as TransactionListPage['filters'];
    const binding = [1, request.principal.workspace, namespace, q, currency, status];
    let afterNamespace: string | null = null, afterId: string | null = null;
    if (query.after !== undefined) {
      try {
        if (typeof query.after !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(query.after)) throw new Error();
        const parts: unknown = JSON.parse(Buffer.from(query.after, 'base64url').toString('utf8'));
        if (!Array.isArray(parts) || parts.length !== 8 || parts.slice(0, 6).some((value, index) => value !== binding[index])
          || typeof parts[6] !== 'string' || !NAMESPACE.test(parts[6]) || typeof parts[7] !== 'string' || !TRANSACTION_ID.test(parts[7])
          || namespace !== null && parts[6] !== namespace || q !== null && !parts[7].startsWith(q as string)
          || Buffer.from(JSON.stringify(parts)).toString('base64url') !== query.after) throw new Error();
        afterNamespace = parts[6]; afterId = parts[7];
      } catch { throw invalidList(); }
    }
    try {
      // Filters on mutable fields apply after selecting the latest revision.
      const result = await this.database.pool.query(`WITH latest AS (
        SELECT DISTINCT ON (namespace,transaction_id) namespace,transaction_id,revision_number,payload,publication,recorded_at
        FROM platform.local_transaction_revisions
        WHERE workspace_key=$1 AND ($2::text IS NULL OR namespace=$2)
          AND ($3::text IS NULL OR left(transaction_id,length($3))=$3)
          AND ($6::text IS NULL OR (namespace,transaction_id)>($6,$7))
        ORDER BY namespace,transaction_id,revision_number DESC
      ) SELECT namespace,transaction_id,revision_number,payload,publication,
        to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at
        FROM latest WHERE ($4::text IS NULL OR payload->>'currency'=$4) AND ($5::text IS NULL OR payload->>'transaction_status'=$5)
        ORDER BY namespace,transaction_id LIMIT $8`,
      [request.principal.workspace, namespace, q, currency, status, afterNamespace, afterId, Number(limit) + 1]);
      const items: TransactionListItem[] = result.rows.slice(0, Number(limit)).map(row => {
        const validated = validateTransactionRevision({ format: 1, provenance: 'local_synthetic', execution_mode: 'test',
          workspace_key: request.principal.workspace, expected_revision: row.revision_number - 1, transaction: row.payload,
          ...(row.publication === null ? {} : { publication: row.publication }) });
        const tx = validated.transaction;
        if (tx.transaction_id !== row.transaction_id || tx.source_reference.namespace !== row.namespace) throw new Error();
        return { namespace: row.namespace, transaction_id: row.transaction_id, revision_number: row.revision_number,
          amount: tx.amount, currency: tx.currency, transaction_status: tx.transaction_status, observed_at: tx.observed_at, recorded_at: row.recorded_at };
      });
      const last = items.at(-1);
      return { provenance: 'local_synthetic', execution_mode: 'test', canonical_emission: false, source_semantics: 'unverified',
        workspace_key: request.principal.workspace, pagination: 'live_committed_view_namespace_id_order', filters, items,
        next_cursor: result.rows.length > Number(limit) && last ? Buffer.from(JSON.stringify([...binding, last.namespace, last.transaction_id])).toString('base64url') : null };
    } catch { throw new ServiceUnavailableException({ code: 'TRANSACTIONS_UNAVAILABLE', message: 'Local transaction observations are unavailable.' }); }
  }

  @Get(':namespace/:transaction_id/revisions/latest')
  @ApiParam({ name: 'namespace', description: 'Explicit synthetic namespace' })
  @ApiParam({ name: 'transaction_id', description: 'Opaque synthetic ID; leading zeros are significant' })
  @ApiOperation({ summary: 'Read latest published synthetic observation; foreign/unknown IDs return an empty page, not a business readiness result' })
  @ApiOkResponse({ type: TransactionRevisionPage })
  latest(@Req() request: ScopedRequest, @Param('namespace') namespace: string, @Param('transaction_id') id: string, @Query() query: Record<string, unknown>) {
    return this.read(request, namespace, id, query, 'latest');
  }

  @Get(':namespace/:transaction_id/revisions')
  @ApiParam({ name: 'namespace', description: 'Explicit synthetic namespace' })
  @ApiParam({ name: 'transaction_id', description: 'Opaque synthetic ID; leading zeros are significant' })
  @ApiOperation({ summary: 'Read immutable synthetic revision history; revision order is publication order, not source lifecycle order' })
  @ApiQuery({ name: 'after', required: false, type: String, description: 'Exclusive ascending revision_number cursor; default0' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiOkResponse({ type: TransactionRevisionPage })
  history(@Req() request: ScopedRequest, @Param('namespace') namespace: string, @Param('transaction_id') id: string, @Query() query: Record<string, unknown>) {
    return this.read(request, namespace, id, query, 'history');
  }

  private async read(request: ScopedRequest, namespace: string, id: string, query: Record<string, unknown>, view: 'latest' | 'history'): Promise<TransactionRevisionPage> {
    const after = query.after ?? '0', limit = query.limit ?? '25';
    if (!/^synthetic_[a-z0-9_]{1,40}$/.test(namespace) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)
      || Object.keys(query).some(key => view === 'latest' || !['after', 'limit'].includes(key))
      || typeof after !== 'string' || !/^(0|[1-9]\d{0,9})$/.test(after) || Number(after) > 2147483647
      || typeof limit !== 'string' || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100) {
      throw new BadRequestException({ code: 'INVALID_QUERY', message: 'Invalid local transaction query.' });
    }
    try {
      const args = view === 'latest' ? [request.principal.workspace, namespace, id]
        : [request.principal.workspace, namespace, id, Number(after), Number(limit) + 1];
      const result = await this.database.pool.query(`SELECT revision_number,payload,publication,
        to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at
        FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=$3
        ${view === 'latest' ? 'ORDER BY revision_number DESC LIMIT 1' : 'AND revision_number>$4 ORDER BY revision_number LIMIT $5'}`, args);
      const items: TransactionRevisionView[] = result.rows.slice(0, view === 'latest' ? 1 : Number(limit)).map(row => {
        const validated = validateTransactionRevision({ format: 1, provenance: 'local_synthetic', execution_mode: 'test',
          workspace_key: request.principal.workspace, expected_revision: row.revision_number - 1, transaction: row.payload,
          ...(row.publication === null ? {} : { publication: row.publication }) });
        return { revision_number: row.revision_number, recorded_at: row.recorded_at,
          payload: validated.transaction, publication: validated.publication ?? null };
      });
      return { provenance: 'local_synthetic', execution_mode: 'test', canonical_emission: false, source_semantics: 'unverified',
        workspace_key: request.principal.workspace, namespace, transaction_id: id, view, pagination: 'live_committed_view',
        items, next_cursor: view === 'history' && result.rows.length > Number(limit) ? String(items.at(-1)!.revision_number) : null };
    } catch { throw new ServiceUnavailableException({ code: 'TRANSACTIONS_UNAVAILABLE', message: 'Local transaction observations are unavailable.' }); }
  }
}
