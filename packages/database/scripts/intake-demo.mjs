import { readFile } from 'node:fs/promises';
import { createSourceIntake } from '../dist/index.js';
import { dsn, loadState, localMode } from './local.mjs';

try {
  localMode();
  const state = await loadState();
  const intake = createSourceIntake(dsn(state, 'intake'));
  try {
    const event = JSON.parse(await readFile(new URL('../fixtures/source-event.json', import.meta.url), 'utf8'));
    console.info(JSON.stringify(await intake.append(event)));
  } finally { await intake.close(); }
} catch {
  console.error('Local synthetic intake demo failed; configuration/storage diagnostics withheld.');
  process.exitCode = 1;
}
