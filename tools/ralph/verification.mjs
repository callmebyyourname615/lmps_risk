import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, assertCheckpoint, environment, preserveOriginals, toolchain, verifyConfiguration } from './state.mjs';
import { verifyMap } from './requirements.mjs';

export function verifyIntake(root = ROOT) {
  const tools = toolchain(root);
  const env = environment(root);
  assertCheckpoint(root);
  verifyConfiguration(root);
  const map = verifyMap(root);
  const originals = preserveOriginals(root);
  const versions = [
    [tools.node, ['--version'], 'v24.22.0'],
    [tools.pnpm, ['--version'], '11.20.0'],
    [tools.python, ['--version'], 'Python 3.13.15'],
  ];
  for (const [command, arguments_, expected] of versions) {
    if (execFileSync(command, arguments_, { cwd: root, env, encoding: 'utf8', timeout: 15000 }).trim() !== expected) throw new Error('Pinned runtime mismatch.');
  }
  const tests = readdirSync(join(root, 'tools/ralph')).filter(name => name.endsWith('.test.mjs')).sort().map(name => join(root, 'tools/ralph', name));
  if (!tests.length) throw new Error('Automation tests are missing.');
  const checks = [
    ['automation-tests', tools.node, ['--test', '--test-concurrency=1', ...tests]],
    ['publication-and-secrets', tools.python, ['-B', 'ci/security.py']],
  ];
  for (const [name, command, arguments_] of checks) {
    const result = spawnSync(command, arguments_, { cwd: root, env, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0 || result.error) throw new Error(`Verification failed: ${name}. Raw output withheld; run the documented check locally.`);
  }
  assertCheckpoint(root);
  return { ...map, originalFiles: originals.originalFiles, checks: checks.map(([name]) => name), scope: 'read-only-automation-intake', productionReady: false };
}
