import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalOutbox } from '../../../packages/database/dist/index.js';
import { ROOT, dsn, loadState, localMode } from '../../../packages/database/scripts/local.mjs';

let queue;
try {
  localMode(); const path = join(ROOT, '.local/outbox-demo.json');
  let file;
  try {
    file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify({ workspace_key: 'synthetic_local', semantic_key: 'synthetic_notification_demo_v1', notification_ref: randomUUID(), expires_at: new Date(Date.now() + 600000).toISOString() }));
      await file.sync();
    } finally { await file.close(); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let input;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.uid !== process.getuid() || stat.size > 4096) throw new Error();
    const buffer = Buffer.alloc(4097); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw new Error(); input = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally { await file.close(); }
  queue = createLocalOutbox(dsn(await loadState(), 'outbox'));
  const enqueued = await queue.enqueue(input);
  const counts = { claimed: 0, accepted_by_fake: 0, expired: 0, dead: 0, stale: 0 };
  for (let index = 0; index < 25; index++) {
    const work = await queue.claim('synthetic_local');
    if (work.status === 'empty') break;
    if (work.status !== 'claimed') { counts[work.status]++; continue; }
    counts.claimed++;
    // Fake acceptance only: no network, device token, recipient or real provider exists here.
    const finished = await queue.finish(work.claim, 'accepted');
    if (finished.status === 'accepted') counts.accepted_by_fake++;
    else if (finished.status === 'stale') counts.stale++;
    else throw new Error();
  }
  console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', provider: 'fake', enqueue: enqueued.status, ...counts }));
} catch { console.error('Local fake outbox demo failed; payload/configuration/storage diagnostics withheld.'); process.exitCode = 1; }
finally { await queue?.close(); }
