// Disposable synthetic browser acceptance; never connects to configured project runtimes.
import assert from 'node:assert/strict';
import { chmod,mkdir,mkdtemp,rm,writeFile } from 'node:fs/promises';
import { isAbsolute,join,resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createDatabase,readLocalAlert } from '../packages/database/dist/index.js';
import { ROOT,availablePort,dsn,initializeCluster,localMode,startCluster,stopCluster } from '../packages/database/scripts/local.mjs';
import { migrations } from '../packages/database/scripts/migrations.mjs';
import { coreConfig,coreDelivery } from '../apps/risk-workers/test/fixtures/core-detection.mjs';
import { openCoreDetectionRuntime } from '../apps/risk-workers/dist/core-detection-runtime.js';
import { privateDirectory } from '../apps/risk-workers/scripts/private-json.mjs';
import { authFixture } from '../apps/risk-api/scripts/auth-fixture.mjs';
import { createApp } from '../apps/risk-api/dist/app.js';

async function main() {
  localMode();
  if(process.argv.length!==2 || !isAbsolute(process.env.LMPS_PLAYWRIGHT_MODULE??'')) throw Error();
  const portal=resolve(ROOT,'../LMPS_Risk_Portal'), local=join(ROOT,'.local');
  await privateDirectory(local);
  const output=await mkdtemp(join(local,'core-inbox-browser-')),temporary=await mkdtemp('/tmp/lmps-core-browser-');
  await chmod(output,0o700);
  let state,runtime,reader,app,vite,browser;
  try {
    const {chromium}=await import(pathToFileURL(process.env.LMPS_PLAYWRIGHT_MODULE).href);
    const {createServer,loadConfigFromFile}=await import(pathToFileURL(join(portal,'node_modules/vite/dist/node/index.js')).href);
    state=await initializeCluster(join(temporary,'pg'),await availablePort());await startCluster(state);
    await migrations(dsn(state,'migration'),true);
    const dir=join(temporary,'config');await mkdir(dir,{mode:0o700});const f=await coreConfig(dir);
    f.config.alert_policy.included_codes=['FRAUD_HIGH_AMOUNT'];await writeFile(f.path,JSON.stringify(f.config),{mode:0o600});
    runtime=await openCoreDetectionRuntime(dsn(state,'intake'),f.path);reader=createDatabase(dsn(state));
    const ids=[];
    for(let i=0;i<6;i++) {await runtime.consume(coreDelivery(i,'browser_'+i,{amount:'900.00'}));ids.push((await runtime.publishCandidate(i)).alert_id);}
    ids.sort();const auth=await authFixture(temporary);
    ({app}=await createApp({LMPS_ENVIRONMENT:'test',LMPS_POSTGRES_DSN:dsn(state),LMPS_LOCAL_AUTH_CONFIG:auth.path}));
    const alertMethods=[];
    app.getHttpAdapter().getInstance().addHook('onRequest',async request=>{if(request.url.startsWith('/v1/local/alerts'))alertMethods.push(request.method);});
    await app.listen(0,'127.0.0.1');const apiURL=await app.getUrl();
    const previous=process.env.LMPS_ALERT_AUTO_CONNECT;process.env.LMPS_ALERT_AUTO_CONNECT='0';
    try {
      const loaded=await loadConfigFromFile({command:'serve',mode:'development'},join(portal,'vite.config.ts'),portal);
      if(!loaded)throw Error();
      const proxy=Object.fromEntries(Object.keys(loaded.config.server?.proxy??{}).map(key=>[key,{target:apiURL,changeOrigin:false,ws:false}]));
      proxy['/v1/local/alerts']={target:apiURL,changeOrigin:false,ws:false};
      vite=await createServer({...loaded.config,configFile:false,root:portal,base:'/',logLevel:'silent',
        server:{...loaded.config.server,host:'127.0.0.1',port:0,strictPort:false,proxy}});
    } finally {if(previous===undefined)delete process.env.LMPS_ALERT_AUTO_CONNECT;else process.env.LMPS_ALERT_AUTO_CONNECT=previous;}
    await vite.listen();const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',()=>errors.push('browser-runtime-error'));
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());await page.route('https://fonts.gstatic.com/**',route=>route.abort());
    page.setDefaultTimeout(15000);await page.goto(base+'/alerts');
    await page.getByRole('combobox',{name:'Language',exact:true}).selectOption('en');
    const connect=async scope=>{await page.locator('#api-alert-token').fill(await auth.token({scope}));await page.getByRole('button',{name:'Connect',exact:true}).click();};
    assert.equal((await fetch(apiURL+'/v1/local/alerts')).status,401);
    await connect('source:read');await page.getByRole('alert').filter({hasText:'does not have permission'}).waitFor();
    assert.equal(await page.locator('#api-alert-token').inputValue(),'');await connect('alerts:read');
    await page.locator('.api-alerts-page tbody tr').first().waitFor();
    assert.deepEqual(await page.locator('.alert-id-link').allTextContents(),ids.slice(0,5));
    await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Page 2',{exact:true}).waitFor();
    assert.deepEqual(await page.locator('.alert-id-link').allTextContents(),ids.slice(5));
    await page.getByRole('button',{name:'Previous',exact:true}).click();await page.locator('.alert-id-link').first().click();
    await page.locator('.api-finding').first().waitFor();assert.equal(await page.locator('.api-finding').count(),15);
    const saved=await readLocalAlert(reader.pool,'synthetic_local',ids[0]);
    const hashes=await page.locator('.assessment-evidence-hashes .assessment-api-hash').allTextContents();
    assert.ok(hashes.includes(saved.snapshot_sha256));assert.ok(hashes.includes(saved.snapshot.assessment_sha256));
    await page.getByRole('combobox',{name:'Language',exact:true}).selectOption('lo');
    await page.getByRole('heading',{name:'ຫຼັກຖານການປະເມີນທີ່ບັນທຶກໄວ້',exact:true}).waitFor();
    assert.deepEqual(await page.locator('.assessment-evidence-hashes .assessment-api-hash').allTextContents(),hashes);
    await page.getByRole('combobox',{name:'ພາສາ',exact:true}).selectOption('en');
    await stopCluster(state);await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'storage is unavailable'}).waitFor();
    assert.equal(await page.locator('.api-finding').count(),0);await startCluster(state);
    await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.api-finding').first().waitFor();
    await page.getByRole('button',{name:'Back to alerts',exact:true}).click();await page.locator('.alert-id-link').first().waitFor();
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(output,'inbox.png'),fullPage:true,animations:'disabled'});await chmod(join(output,'inbox.png'),0o600);
    await page.reload();await page.locator('#api-alert-token').waitFor();assert.equal(await page.locator('.alert-id-link').count(),0);
    const storage=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage),cookies:document.cookie}));
    assert.equal(storage.session.length,0);assert.equal(storage.cookies,'');assert.ok(storage.local.every(key=>key.includes('locale')));
    assert.ok(alertMethods.length>0 && alertMethods.every(method=>method==='GET'));
    assert.deepEqual(errors,[]);
    await writeFile(join(output,'acceptance.json'),JSON.stringify({status:'passed',scope:'local_synthetic',alerts:6,
      checks:['access','pagination','findings','bilingual_hashes','outage_recovery','mobile','session_reset'],production_ready:false}),{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({status:'passed',scope:'local_synthetic',alerts:6,output}));
  } finally {
    let cleanupFailed=false, clusterStopped=!state;
    for(const close of [()=>browser?.close(),()=>vite?.close(),()=>app?.close(),()=>reader?.close(),()=>runtime?.close()])
      try {await close();} catch {cleanupFailed=true;}
    if(state)try {await stopCluster(state);clusterStopped=true;} catch {cleanupFailed=true;}
    if(clusterStopped)try {await rm(temporary,{recursive:true,force:true});} catch {cleanupFailed=true;}
    if(cleanupFailed)throw Error();
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{console.error('CORE_INBOX_BROWSER_FAILED; private diagnostics withheld.');process.exitCode=1;});
