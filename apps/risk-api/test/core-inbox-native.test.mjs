import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,mkdir,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { availablePort,initializeCluster,startCluster,stopCluster,dsn } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { coreConfig,coreDelivery } from '../../risk-workers/test/fixtures/core-detection.mjs';
import { openCoreDetectionRuntime } from '../../risk-workers/dist/core-detection-runtime.js';
import { authFixture } from '../scripts/auth-fixture.mjs';
import { createApp } from '../dist/app.js';

test('synthetic core candidate is visible in the authenticated local Inbox API',async()=>{
  const temp=await mkdtemp('/tmp/lmps-core-inbox-http-');let state,runtime,app;
  try {
    state=await initializeCluster(join(temp,'pg'),await availablePort());await startCluster(state);
    await migrations(dsn(state,'migration'),true);
    const directory=join(temp,'config');await mkdir(directory,{mode:0o700});
    const f=await coreConfig(directory);f.config.alert_policy.included_codes=['FRAUD_HIGH_AMOUNT'];
    await writeFile(f.path,JSON.stringify(f.config),{mode:0o600});
    runtime=await openCoreDetectionRuntime(dsn(state,'intake'),f.path);
    const candidate=await runtime.consume(coreDelivery(0,'api_alert',{amount:'900.00'}));
    const published=await runtime.publishCandidate(0);
    const auth=await authFixture(temp);
    ({app}=await createApp({LMPS_ENVIRONMENT:'test',LMPS_POSTGRES_DSN:dsn(state),LMPS_LOCAL_AUTH_CONFIG:auth.path}));
    await app.init();
    const get=async scope=>app.inject({method:'GET',url:'/v1/local/alerts/'+published.alert_id,
      headers:{authorization:'Bearer '+await auth.token({scope})}});
    assert.equal((await get('risk:read')).statusCode,403);
    const response=await get('alerts:read');assert.equal(response.statusCode,200);
    assert.equal(response.json().alert.assessment.run_id,candidate.entry.assessment.run_id);
    assert.ok(response.json().alert.selected_risk_types.includes('FRAUD_HIGH_AMOUNT'));
  } finally {await app?.close();await runtime?.close();if(state)await stopCluster(state);await rm(temp,{recursive:true,force:true});}
});
