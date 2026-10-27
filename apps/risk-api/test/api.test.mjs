import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../dist/app.js';
import { readConfig } from '../dist/config.js';

let app;
let origin;

before(async () => {
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test' }));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.equal(address.address, '127.0.0.1');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.close();
});

test('liveness is available without claiming readiness or echoing request data', async () => {
  const response = await fetch(`${origin}/health/live?account=SYNTHETIC_CANARY`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'ok', service: 'risk-api' });
});

test('readiness returns 503 and explicit missing dependencies', async () => {
  const response = await fetch(`${origin}/health/ready`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    status: 'not_ready',
    service: 'risk-api',
    reason: 'bootstrap_only',
    dependencies: {
      postgres: 'not_configured',
      source_sync: 'not_implemented',
      risk_engine: 'not_implemented',
    },
  });
});

test('OpenAPI describes actual health responses and does not invent business endpoints', async () => {
  const response = await fetch(`${origin}/openapi.json`);
  assert.equal(response.status, 200);
  const document = await response.json();
  assert.match(document.openapi, /^3\./);
  assert.equal(document.info.title, 'LMPS Risk API');
  assert.deepEqual(Object.keys(document.paths).sort(), ['/health/live', '/health/ready']);
  assert.equal(document.paths['/health/ready'].get.responses['503'].content['application/json'].schema.$ref,
    '#/components/schemas/ReadinessResponse');
  assert.deepEqual(document.components.schemas.ReadinessResponse.properties.status.enum, ['not_ready']);
  assert.deepEqual(document.components.schemas.BootstrapDependencies.required.sort(),
    ['postgres', 'risk_engine', 'source_sync']);
});

test('Swagger UI and bundled assets are served locally', async () => {
  const ui = await fetch(`${origin}/docs`);
  assert.equal(ui.status, 200);
  assert.match(ui.headers.get('content-type'), /text\/html/);
  assert.match(await ui.text(), /swagger-ui/);
  const css = await fetch(`${origin}/docs/swagger-ui.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match(await css.text(), /swagger-ui/);
});

test('bootstrap does not accept risk assessment mutations', async () => {
  const response = await fetch(`${origin}/v1/risk-assessments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sender_account: 'SYNTHETIC_CANARY' }),
  });
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /SYNTHETIC_CANARY/);
});

test('local defaults and the upper port bound are valid', () => {
  assert.deepEqual(readConfig({}), { environment: 'local', executionMode: 'test', port: 18501 });
  assert.equal(readConfig({ LMPS_API_PORT: '65535' }).port, 65535);
});

test('unsupported environment/mode fails before creating a server', async () => {
  for (const env of [
    { NODE_ENV: 'production' },
    { LMPS_ENVIRONMENT: 'production' },
    { LMPS_EXECUTION_MODE: 'live' },
  ]) {
    await assert.rejects(createApp(env), /bootstrap API supports/);
  }
});

test('invalid ports are rejected without returning their supplied values', () => {
  for (const rawPort of ['0', '-1', '65536', '1.5', '18501junk', '', ' 18501 ', 'SYNTHETIC_SECRET']) {
    assert.throws(() => readConfig({ LMPS_API_PORT: rawPort }), (error) => {
      assert.equal(error.message, 'LMPS_API_PORT must be an integer between 1 and 65535.');
      return true;
    });
  }
});
