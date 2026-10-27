import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ROOT } from '../../../packages/database/scripts/local.mjs';
import { analyzeSemantics, draftSemantics, main, runSemantics } from '../scripts/source-semantics.mjs';

const execute = promisify(execFile);
let scratch, example, sequence = 0;
before(async () => { scratch = await mkdtemp('/tmp/lmps-semantic-cli-'); example = await fixture(); });
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });
async function fixture() {
  const root = join(scratch, 'fixture-' + ++sequence); await mkdir(root, { mode: 0o700 });
  const source = join(root, 'source'), adapted = join(root, 'adapted');
  const result = await execute(join(ROOT, '.venv/bin/python'), ['-B', '-c',
    'import sys,json; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from test_dataset_pilot import write_bundle,pilot; import dataset_semantics; write_bundle(Path(sys.argv[2])); pilot.adapt(Path(sys.argv[2]),Path(sys.argv[3])); print(json.dumps(dataset_semantics.evidence(Path(sys.argv[3]))))',
    join(ROOT, 'apps/risk-workers/test'), source, adapted], { cwd: ROOT, timeout: 10000 });
  return { root, adapted, evidence: JSON.parse(result.stdout) };
}
function declared(evidence = example.evidence) {
  const mapping = draftSemantics(evidence);
  mapping.version = 'lmps_semantics_synthetic_declared_v1'; mapping.status = 'owner_declared';
  mapping.evidence = { reference: 'synthetic-owner/review-1', sha256: 'b'.repeat(64), owner_role: 'lmps_source_owner' };
  for (const entry of mapping.lifecycle) { entry.operation = 'payment'; entry.state = 'succeeded'; }
  for (const entry of mapping.currencies) { entry.currency = 'XXX'; entry.amount_unit = 'minor'; entry.fee_unit = 'major'; }
  mapping.time = { field: 'txtime', meaning: 'business_occurrence', timezone: '+07:00' };
  return mapping;
}
async function command(args) {
  const info = console.info, error = console.error, out = [], errors = [];
  console.info = value => out.push(value); console.error = value => errors.push(value);
  try { return { code: await main(args), stdout: out.join('\n'), stderr: errors.join('\n') }; }
  finally { console.info = info; console.error = error; }
}

test('draft preserves NULL/empty/code frequencies and leaves all real patterns blocked', () => {
  const evidence = structuredClone(example.evidence); evidence.records[1].result = ''; evidence.records[2].result = '000';
  const mapping = draftSemantics(evidence), result = analyzeSemantics(evidence, mapping);
  assert.deepEqual(result.counts, { rows: 3, lifecycle_declared: 0, currency_declared: 0, time_declared: 0, fully_declared: 0, unavailable: 3 });
  assert.equal(result.patterns.length, 15); assert.equal(result.ready_patterns, 0);
  assert.equal(result.raw_observations.code_counts.result.length, 3);
  assert.ok(result.patterns.every(p => p.readiness === 'blocked'));
  assert.equal(result.assessment_performed, false);
  assert.ok(result.rows.every(row => row.operation === 'unknown' && row.net_executed_amount === null));
});

test('full owner-declared coverage is distinct from independently verified semantics and real assessments', () => {
  const result = analyzeSemantics(example.evidence, declared());
  assert.equal(result.validation_status, 'complete'); assert.equal(result.counts.fully_declared, 3);
  assert.equal(result.external_evidence_verified, false); assert.equal(result.source_semantics, 'unverified');
  assert.equal(result.ready_patterns, 0); assert.equal(result.operational_alerts, false);
  assert.ok(result.patterns.every(p => p.reason_codes.includes('SOURCE_DECLARATIONS_NOT_INDEPENDENTLY_VERIFIED')));
  assert.ok(result.rows.every(row => row.currency === 'XXX' && row.amount_unit === 'minor' && row.net_executed_amount === null));
  assert.equal(result.raw_observations.review_counts.negative_amount, 1);
});

test('unmapped codes and case/whitespace mismatches stay unavailable with exact row lineage', () => {
  const evidence = structuredClone(example.evidence); evidence.records[0].result = 'new'; evidence.records[1].ccy = 'syn';
  const result = analyzeSemantics(evidence, declared());
  assert.equal(result.counts.fully_declared, 1);
  assert.ok(result.rows[0].reason_codes.includes('LIFECYCLE_CODE_UNMAPPED'));
  assert.ok(result.rows[1].reason_codes.includes('CURRENCY_CODE_UNMAPPED'));
  assert.equal(result.rows[0].source_row_sha256, evidence.records[0].source_row_sha256);
  assert.equal(result.rows[0].row_number, 1);
});

test('declared reversal, negative amounts and naive time order never create net settlement or account linkage', () => {
  const mapping = declared(); mapping.lifecycle[0].operation = 'reversal';
  const evidence = structuredClone(example.evidence);
  evidence.records[0].responsetime = '2026-09-30 23:59:59'; evidence.records[1].settletime = '2026-09-30 23:59:59';
  evidence.records[0].amount = '-0.00'; evidence.records[1].amount = '9999999999999999999999.99';
  evidence.records[2].originalreference_presence = 'present';
  const result = analyzeSemantics(evidence, mapping);
  assert.equal(result.raw_observations.review_counts.reversal_declared, 3);
  assert.equal(result.raw_observations.review_counts.zero_amount, 1);
  assert.equal(result.raw_observations.review_counts.response_before_request, 1);
  assert.equal(result.raw_observations.review_counts.settlement_before_request, 1);
  assert.equal(result.raw_observations.review_counts.original_reference_present, 1);
  assert.ok(result.rows.every(row => row.review_reason_codes.includes('REVERSAL_LINKAGE_UNVERIFIED') && row.net_executed_amount === null));
  assert.equal(result.validation_status, 'complete');
});

test('mapping scope, extra fields, invalid dates and oversized evidence fail before classification', () => {
  const mapping = declared(); mapping.source_manifest_sha256 = 'c'.repeat(64);
  assert.throws(() => analyzeSemantics(example.evidence, mapping));
  for (const mutate of [row => { row.fromaccount = 'PRIVATE'; }, row => { row.requesttime = '2026-02-30 00:00:00'; },
    row => { row.amount = 1; }, row => { row.amount = '1.00\n'; }, row => { row.row_number = 2; },
    row => { row.source_row_sha256 += '\n'; }]) {
    const input = structuredClone(example.evidence); mutate(input.records[0]);
    assert.throws(() => draftSemantics(input));
  }
  assert.throws(() => draftSemantics({ ...example.evidence, source_rows: 1001 }));
});

test('actual private CLI bridge publishes deterministically, retries and rejects changed version/run content', async () => {
  const output = join(example.root, 'reports'), runId = randomUUID();
  const args = ['--adapted', example.adapted, '--output', output, '--run-id', runId];
  const first = await command(args);
  assert.equal(first.code, 2, first.stderr);
  assert.equal(JSON.parse(first.stdout).publication, 'created');
  assert.equal((await command(args)).code, 2);
  const reportPath = join(output, 'v1', runId, 'semantics.json'), before = await readFile(reportPath);
  const mapping = declared(), mappingPath = join(example.root, 'mapping.json');
  await writeFile(mappingPath, JSON.stringify(mapping), { mode: 0o600 });
  const changed = await command([...args, '--mapping', mappingPath]);
  assert.equal(changed.code, 1); assert.deepEqual(await readFile(reportPath), before);
  const nextId = randomUUID();
  const completed = await command(['--adapted', example.adapted, '--output', output, '--run-id', nextId, '--mapping', mappingPath]);
  assert.equal(completed.code, 0, completed.stderr);
  assert.equal(JSON.parse(completed.stdout).counts.fully_declared, 3);
  mapping.currencies[0].amount_unit = 'major';
  await writeFile(mappingPath, JSON.stringify(mapping));
  assert.equal((await command(['--adapted', example.adapted, '--output', output, '--run-id', randomUUID(), '--mapping', mappingPath])).code, 1);
  for (const marker of ['SYNTHETIC_PRIVATE_ACCOUNT','SYNTHETIC_PRIVATE_QR','SYNTHETIC_REFERENCE',example.root,'+07:00']) {
    assert.equal((first.stdout + first.stderr + completed.stdout + completed.stderr).includes(marker), false);
    assert.equal(before.toString().includes(marker), false);
  }
});

test('partial publications, tampered evidence and unsafe mapping files are rejected without replacement', async () => {
  const value = await fixture(), output = join(value.root, 'reports'), id = randomUUID();
  await mkdir(output, { mode: 0o700 }); await mkdir(join(output, 'v1'), { mode: 0o700 }); await mkdir(join(output, 'v1', id), { mode: 0o700 });
  const args = ['--adapted', value.adapted, '--output', output, '--run-id', id];
  assert.equal((await command(args)).code, 1);
  assert.deepEqual(await readdir(join(output, 'v1', id)), []);
  const mappingPath = join(value.root, 'mapping.json'); await writeFile(mappingPath, JSON.stringify(declared(value.evidence)), { mode: 0o644 });
  assert.equal((await command([...args, '--mapping', mappingPath])).code, 1);
  await chmod(mappingPath, 0o600);
  await writeFile(join(value.adapted, 'lineage.jsonl'), 'tampered');
  const result = await command([...args, '--mapping', mappingPath]);
  assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /^SEMANTICS_VALIDATION_FAILED/);
});

test('production mode, source/output overlap and malformed CLI arguments publish no output', async () => {
  const value = await fixture(), output = join(value.root, 'reports'), runId = randomUUID();
  await assert.rejects(runSemantics({ adapted: value.adapted, output: value.adapted, runId }));
  await assert.rejects(runSemantics({ adapted: value.adapted, output, runId: runId + '\n' }));
  assert.equal((await command(['--adapted', value.adapted, '--output', output, '--run-id', runId, '--unknown', 'PRIVATE'])).code, 1);
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal((await command(['--adapted', value.adapted, '--output', output, '--run-id', runId])).code, 1);
  } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
  assert.equal((await readdir(value.root)).includes('reports'), false);
});
