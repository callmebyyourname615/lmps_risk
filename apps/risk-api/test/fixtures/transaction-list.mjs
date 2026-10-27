import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions } from '@lmps/database';
import { createApp } from '../../dist/app.js';
import { authFixture } from '../../scripts/auth-fixture.mjs';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster, loadState } from '../../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../../packages/database/scripts/migrations.mjs';
import { revision } from '../../../../packages/database/test/fixtures/transaction-revision.mjs';
import { publicationFixture } from '../../../../packages/contracts/fixtures/synthetic-publication.mjs';
import { publicationTransaction } from '../../../../packages/contracts/dist/synthetic-publication.js';

export async function transactionListFixture() {
  let temporary, state, writer, owner, app;
  const close = async () => {
    await app?.close(); await writer?.close(); await owner?.close();
    if (temporary && !state) try { state = await loadState(join(temporary, 'pg')); } catch {}
    if (state) await stopCluster(state);
    if (temporary) await rm(temporary, { recursive: true, force: true });
  };
  try {
    temporary = await mkdtemp('/tmp/lmps-transaction-list-');
    state = await initializeCluster(join(temporary, 'pg'), await availablePort());
    await startCluster(state); await migrations(dsn(state, 'migration'), true);
    writer = createTransactionRevisions(dsn(state, 'intake')); owner = createDatabase(dsn(state, 'migration'), 'migration');
    const expected = [];
    async function append(id, namespace = 'synthetic_transactions', count = 1, currency = 'USD', workspace = 'synthetic_local') {
      let last;
      for (let n = 0; n < count; n++) {
        const value = revision(n); value.workspace_key = workspace;
        value.transaction.transaction_id = id; value.transaction.source_reference.namespace = namespace;
        value.transaction.amount = id === '0009007199254740993' && n === count - 1 ? '9999999999999999999999.99' : `${100 + n}.00`;
        value.transaction.currency = currency;
        value.transaction.observed_at = `2026-10-${String(20 - n).padStart(2, '0')}T10:00:00Z`;
        await writer.append(value); last = value;
      }
      if (workspace === 'synthetic_local') expected.push({ namespace, transaction_id: id, revision_number: count, amount: last.transaction.amount });
    }
    for (const id of ['0009007199254740993', '001', '01', '1', 'Alpha_1', 'alpha_1', 'literal_1', 'literalX1']) await append(id, 'synthetic_transactions', id === '0009007199254740993' ? 3 : 1);
    await append('001', 'synthetic_alternate', 2, 'LAK');
    for (let i = 1; i <= 30; i++) await append(`row_${String(i).padStart(3, '0')}`, 'synthetic_transactions', 1, i % 2 ? 'USD' : 'LAK');
    const changing = revision(); changing.transaction.transaction_id = 'currency_changes'; changing.transaction.currency = 'USD'; await writer.append(changing);
    const changed = revision(1); changed.transaction.transaction_id = 'currency_changes'; changed.transaction.currency = 'EUR'; await writer.append(changed);
    expected.push({ namespace: 'synthetic_transactions', transaction_id: 'currency_changes', revision_number: 2, amount: changed.transaction.amount });
    for (let i = 0; i < 2; i++) {
      const value = publicationFixture(i);
      if (i === 1) value.publication.normalization_input.status_code = 'SYNTH_FAILED';
      value.transaction = publicationTransaction(value.publication).transaction;
      await writer.append(value);
      if (i === 1) expected.push({ namespace: 'synthetic_snapshot', transaction_id: value.transaction.transaction_id, revision_number: 2, amount: value.transaction.amount });
    }
    await append('foreign_secret', 'synthetic_transactions', 1, 'USD', 'synthetic_other');
    expected.sort((a, b) => a.namespace === b.namespace ? a.transaction_id < b.transaction_id ? -1 : a.transaction_id === b.transaction_id ? 0 : 1 : a.namespace < b.namespace ? -1 : 1);
    const auth = await authFixture(temporary);
    ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path }));
    await app.listen(0, '127.0.0.1'); const origin = await app.getUrl();
    return { app, origin, expected, temporary, state, owner, writer, close,
      token: changes => auth.token({ sub: 'synthetic_transaction_reader', scope: 'alerts:read transactions:read risk:read', ...changes }),
      transport: async (path, options) => { const response = await app.inject({ method: options.method, url: path, headers: options.headers }); return new Response(response.body, { status: response.statusCode }); },
      stopDatabase: () => stopCluster(state), startDatabase: () => startCluster(state),
    };
  } catch (error) { await close(); throw error; }
}
