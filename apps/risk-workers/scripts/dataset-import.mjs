import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createOfflineDatasets, validateDatasetSnapshot } from '@lmps/database';
import { DATASET_DIGEST, datasetMode, validateDatasetInput, validateDatasetValues, OfflineDatasetError } from '@lmps/contracts/offline-dataset';
import { ROOT, dsn, loadState } from '../../../packages/database/scripts/local.mjs';
import { privateDirectory, readPrivateJson } from './private-json.mjs';
import { importOfflineDataset, reconcileOfflineDataset } from '../dist/offline-dataset.js';

export async function readOfflineDataset(input, path) {
  datasetMode(); const request = validateDatasetInput(input);
  let child, finished, timer;
  try {
    if (!isAbsolute(path)) throw new Error();
    await privateDirectory(dirname(path));
    child = spawn(join(ROOT, '.venv/bin/python'), ['-B', join(ROOT, 'apps/risk-workers/scripts/dataset_rows.py'), request.source_table, path, request.dataset_sha256],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
    finished = new Promise(resolve => { child.once('error', () => resolve(false)); child.once('exit', code => resolve(code === 0)); });
    timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    const rows = [], hash = createHash('sha256'); let header, pending = Buffer.alloc(0), total = 0;
    for await (const chunk of child.stdio[3]) {
      total += chunk.length; if (total > 192 * 1024 * 1024) throw new Error();
      pending = Buffer.concat([pending, chunk]);
      let newline;
      while ((newline = pending.indexOf(10)) >= 0) {
        if (newline > 4096) throw new Error();
        const item = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(0, newline)));
        pending = pending.subarray(newline + 1);
        if (!header) {
          if (!item || Object.keys(item).sort().join(',') !== 'dataset_sha256,expected_rows,input_bytes,profile_version,rows_sha256'
            || item.dataset_sha256 !== request.dataset_sha256 || item.expected_rows !== request.expected_rows
            || item.input_bytes !== request.input_bytes || item.profile_version !== request.profile_version
            || typeof item.rows_sha256 !== 'string' || !DATASET_DIGEST.test(item.rows_sha256)) throw new Error();
          header = item;
        } else {
          if (rows.length >= request.expected_rows) throw new Error();
          const row = validateDatasetValues(request.source_table, item); rows.push(row); hash.update(JSON.stringify(row) + '\n');
        }
      }
      if (pending.length > 4096) throw new Error();
    }
    if (!await finished || pending.length || !header || rows.length !== request.expected_rows || hash.digest('hex') !== header.rows_sha256) throw new Error();
    return validateDatasetSnapshot({ manifest: { ...request, rows_sha256: header.rows_sha256 }, rows });
  } catch { throw new OfflineDatasetError('DATASET_FILE_REJECTED'); }
  finally {
    clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await finished;
  }
}

export async function main(args = process.argv.slice(2), targetDsn) {
  let repo;
  try {
    datasetMode();
    const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { manifest: { type: 'string' }, input: { type: 'string' }, workspace: { type: 'string' }, batch: { type: 'string' } } });
    if (positionals.length !== 1) throw new OfflineDatasetError('DATASET_INVALID_INPUT');
    const [action] = positionals;
    if (action === 'status') {
      if (Object.keys(values).sort().join(',') !== 'batch,workspace') throw new OfflineDatasetError('DATASET_INVALID_INPUT');
      repo = createOfflineDatasets(targetDsn ?? dsn(await loadState(), 'intake'));
      const result = await repo.status(values.workspace, values.batch); console.info(JSON.stringify(result));
      return result.status === 'complete' ? 0 : 2;
    }
    if (!['import', 'reconcile'].includes(action) || Object.keys(values).sort().join(',') !== 'input,manifest' || !isAbsolute(values.manifest)) throw new OfflineDatasetError('DATASET_INVALID_INPUT');
    await privateDirectory(dirname(values.manifest));
    const snapshot = await readOfflineDataset(await readPrivateJson(values.manifest, 16384), values.input);
    const connection = targetDsn ?? dsn(await loadState(), 'intake');
    const result = await (action === 'import' ? importOfflineDataset : reconcileOfflineDataset)(connection, snapshot);
    console.info(JSON.stringify(result)); return result.status === 'complete' ? 0 : 2;
  } catch (error) {
    console.error((error instanceof OfflineDatasetError ? error.code : 'DATASET_INVALID_INPUT') + '; private diagnostics withheld.'); return 1;
  } finally { await repo?.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
