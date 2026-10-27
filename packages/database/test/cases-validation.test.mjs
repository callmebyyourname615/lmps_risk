import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readCaseHistory } from '../dist/index.js';
test('invalid case history/mode is rejected before acquiring a database connection', async () => {
  let calls = 0;
  const pool = {
    async connect() {
      calls++;
      throw new Error('Should not connect');
    },
  };
  const id = randomUUID();
  for (const args of [
    ['synthetic_local', 'bad', 'events', 0, 5],
    ['synthetic_local', id, 'unknown', 0, 5],
    ['synthetic_local', id, 'events', -1, 5],
    ['synthetic_local', id, 'events', 0, 11],
  ])
    await assert.rejects(readCaseHistory(pool, ...args), (e) => e.code === 'CASE_INVALID_INPUT');
  const previous = process.env.LMPS_ENVIRONMENT;
  process.env.LMPS_ENVIRONMENT = 'production';
  try {
    await assert.rejects(
      readCaseHistory(pool, 'synthetic_local', id, 'events'),
      (e) => e.code === 'CASE_INVALID_INPUT',
    );
  } finally {
    if (previous === undefined) delete process.env.LMPS_ENVIRONMENT;
    else process.env.LMPS_ENVIRONMENT = previous;
  }
  assert.equal(calls, 0);
});
