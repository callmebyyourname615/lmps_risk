import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from '../dist/index.js';
import { LOCAL, loadState, localMode } from './local.mjs';

export async function readLocalConfig(base = LOCAL) {
  localMode();
  const state = await loadState(base);
  if (!state.ready) throw new Error('Incomplete local fixture.');
  const file = join(base, 'preflight.json');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error('Unsafe local configuration.');
  const config = JSON.parse(await readFile(file, 'utf8'));
  if (config.port !== state.port || config.caFile !== join(state.base, 'ca.crt')) throw new Error('Local configuration does not match owned fixture.');
  return config;
}

export async function main() {
  try {
    const report = await inspect(await readLocalConfig());
    console.info(JSON.stringify(report, null, 2));
    return report.status === 'complete_for_local_metadata' ? 0 : 2;
  } catch {
    console.error('Local preflight failed; connection/configuration diagnostics withheld.');
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = await main();
