import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compileFromFile } from 'json-schema-to-typescript';

for (const name of ['transaction', 'risk-assessment', 'alert', 'ml-shadow-request', 'ml-shadow-result']) {
  const input = new URL(`../schemas/${name}.schema.json`, import.meta.url);
  const output = new URL(`../src/generated/${name}.ts`, import.meta.url);
  const generated = await compileFromFile(fileURLToPath(input), {
    bannerComment: '/* Generated from Pydantic JSON Schema. Run pnpm generate:contracts; do not edit. */',
  });
  if (process.argv.includes('--check')) {
    assert.equal(await readFile(output, 'utf8'), generated, `Stale generated types: ${name}`);
  } else {
    await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
    await writeFile(output, generated);
  }
}
