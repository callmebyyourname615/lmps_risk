import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../dist/index.js';

const defaultFolder = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrations(dsn, apply = false, folder = defaultFolder) {
  const database = createDatabase(dsn, 'migration');
  let client;
  try {
    const expected = readMigrationFiles({ migrationsFolder: folder });
    const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8'));
    if (journal.entries.length !== expected.length || expected.some((entry, index) => !Number.isSafeInteger(entry.folderMillis)
      || entry.folderMillis <= 0 || (index > 0 && entry.folderMillis <= expected[index - 1].folderMillis)
      || journal.entries[index].idx !== index || !/^\d{4}_[a-z0-9_]+$/.test(journal.entries[index].tag))) throw new Error();
    client = await database.pool.connect();
    await client.query('SELECT pg_advisory_lock(18503, 8)');
    const exists = await client.query("SELECT to_regclass('lmps_migrations.__drizzle_migrations') AS ledger");
    const applied = exists.rows[0].ledger ? (await client.query('SELECT hash, created_at FROM lmps_migrations.__drizzle_migrations ORDER BY created_at, id')).rows : [];
    if (applied.length > expected.length || applied.some((entry, index) => entry.hash !== expected[index].hash || String(entry.created_at) !== String(expected[index].folderMillis))) throw new Error();
    if (apply) {
      await migrate(drizzle(client), { migrationsFolder: folder, migrationsSchema: 'lmps_migrations' });
    }
    return journal.entries.map((entry, index) => ({ migration: entry.tag, status: apply || index < applied.length ? 'applied' : 'pending' }));
  } catch {
    throw new Error('Local database migration check/apply failed.');
  } finally {
    // Destroying this dedicated session also releases the migration advisory lock.
    client?.release(true);
    await database.close();
  }
}
