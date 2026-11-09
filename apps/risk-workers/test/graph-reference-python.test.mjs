import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('independent Python graph reference: actual bounded local unittest subprocess (not native SQL acceptance)', { timeout: 60000 }, () => {
  const result = spawnSync(`${root}.venv/bin/python`, [
    '-B', '-I', `${root}services/ml-inference/tests/test_graph_benchmark.py`,
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 45000,
    killSignal: 'SIGKILL',
    detached: true,
    maxBuffer: 65536,
    env: { LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1' },
  });
  // A timeout must also clean up any still-running unittest CLI children.
  if (result.pid) {
    try { process.kill(-result.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, 'Python graph unittest suite failed');
  assert.match(result.stderr, /Ran [0-9]+ tests/);
  assert.match(result.stderr, /\bOK\b/);
  assert.equal(result.stdout, '');
});
