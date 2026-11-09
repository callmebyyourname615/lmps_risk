import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, chmod, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runMonthReadiness } from '../scripts/month-readiness.mjs';
import { runMaskScreen } from '../scripts/month-mask-screen.mjs';

const execute=promisify(execFile);
const columns='id requesttime txtime reference frommember tomember totype amount ccy result responsetime txtype originalreference shouldrevert isreconciled issettled settletime qrtype fromchannel fromaccount toaccount fee'.split(' ');
const field=v=>v===null?'\\N':String(v).replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll('\t','\\t');

test('actual masked window CLI binds source/time/units, exact union and private immutable trace replay',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'lmps-mask-test-')));
  try{
    await chmod(root,0o700);
    const rows=[];
    for(let i=0;i<1005;i++)rows.push({...Object.fromEntries(columns.map(c=>[c,null])),id:String(i+1),
      requesttime:'2026-10-01 01:00:00',txtime:'2026-10-01 01:00:00',reference:'PRIVATE_REFERENCE',
      frommember:'SYN_A',tomember:'SYN_B',totype:'SYN_TYPE',amount:i>=1000?'1000000.00':'1.00',ccy:'LAK',result:'OK',shouldrevert:'0',
      isreconciled:'0',issettled:'0',fromaccount:i>=1000?'PRIVATE_EXCEPTIONAL_MASK':'PRIVATE_MASK_FROM_'+i,toaccount:'PRIVATE_MASK_TO_'+i});
    const raw=columns.join('\t')+'\n'+rows.map(r=>columns.map(c=>field(r[c])).join('\t')+'\n').join('');
    const bytes=gzipSync(raw),input=join(root,'source.tsv.gz'),planPath=join(root,'plan.json'),output=join(root,'masked');
    await writeFile(input,bytes,{mode:0o600});
    const plan={format:'lmps-month-profile-1',month:'2026-10',amount_screens:[],files:[{
      path:input,table:'transfer',encoding:'export_tsv_gzip',sha256:createHash('sha256').update(bytes).digest('hex'),expected_rows:rows.length}]};
    await writeFile(planPath,JSON.stringify(plan),{mode:0o600});
    const p=await runMonthReadiness({planPath,output:join(root,'profile')});
    const profilePath=join(root,'profile/v1',p.analysis_id,'report.json');
    const result=await runMaskScreen({planPath,profilePath,output});
    assert.equal(result.status,'screened');assert.equal(result.candidate_source_row_anchors,5);
    const dir=join(output,'v1',result.analysis_id),reportBytes=await readFile(join(dir,'report.json')),traceBytes=await readFile(join(dir,'traces.json'));
    const report=JSON.parse(reportBytes);
    assert.equal(report.observed_rows,1005);assert.equal(report.cohort.included,1005);
    assert.equal(report.metrics.length,12);assert.equal(report.profile.time_zone,'Asia/Vientiane');
    assert.equal(report.profile.amount_unit,'major');assert.equal(report.identity_status,'unverified');
    assert.equal(report.canonical_assessment,false);assert.equal(report.production_ready,false);
    assert.ok(report.core_pattern_results.every(p=>p.matched_count===null));
    assert.equal(report.anchor_trace_verification.status,'passed');
    assert.equal(report.anchor_trace_verification.anchors,JSON.parse(traceBytes).length);
    assert.ok(report.metrics.some(m=>m.candidate_anchors===5));
    for(const name of ['PRIVATE_MASK','PRIVATE_REFERENCE','PRIVATE_EXCEPTIONAL',input]){
      assert.equal(reportBytes.includes(Buffer.from(name)),false);assert.equal(traceBytes.includes(Buffer.from(name)),false);
    }
    const secret=await readFile(join(output,'.mask-key.json'));
    const key=JSON.parse(secret).key_b64;
    assert.equal(reportBytes.includes(Buffer.from(key)),false);assert.equal(traceBytes.includes(Buffer.from(key)),false);
    assert.equal((await stat(join(output,'.mask-key.json'))).mode&0o777,0o600);
    assert.equal((await runMaskScreen({planPath,profilePath,output})).status,'duplicate');
    assert.deepEqual(await readFile(join(dir,'report.json')),reportBytes);
    const cli=new URL('../scripts/month-mask-screen.mjs',import.meta.url).pathname;
    const success=await execute(process.execPath,[cli,'--plan',planPath,'--profile',profilePath,'--output',output]);
    assert.equal(JSON.parse(success.stdout).status,'duplicate');assert.equal(success.stderr,'');
    const denied=await execute(process.execPath,[cli,'--plan',planPath,'--profile',profilePath,'--output',output],{
      env:{...process.env,LMPS_ENVIRONMENT:'production'},
    }).then(()=>null,e=>e);
    assert.equal(denied.stderr.trim(),'MASK_SCREEN_FAILED; private diagnostics withheld.');
    await assert.rejects(runMaskScreen({planPath,profilePath,output:input}));
    await writeFile(input,Buffer.concat([bytes,Buffer.from('CHANGED')]));
    await assert.rejects(runMaskScreen({planPath,profilePath,output}));
    assert.deepEqual(await readFile(join(dir,'report.json')),reportBytes);
    assert.ok(!(await readdir(root)).some(n=>n.startsWith('.mask-screen-')));
  }finally{await rm(root,{recursive:true,force:true});}
});
