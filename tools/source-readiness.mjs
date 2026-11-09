import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const READINESS_GATES = Object.freeze(['source_permission','source_semantics','identity_masking','historical_availability','reference_authority','security','capacity','dr','release']);
export function evaluateSourceReadiness(input) {
  const invalid = () => { throw new Error('SOURCE_READINESS_INVALID'); };
  const object = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const exact = (value, keys) => object(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => { const d=Object.getOwnPropertyDescriptor(value,key);return d?.enumerable && 'value' in d; });
  if (!exact(input,['version','gates']) || input.version!==1 || !exact(input.gates,READINESS_GATES)) invalid();
  const pending=[];
  for(const key of READINESS_GATES){
    const gate=input.gates[key];
    if(!exact(gate,['status','owner_ref','evidence_sha256']) || !['pending','attested'].includes(gate.status)
      || !(gate.owner_ref===null || typeof gate.owner_ref==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(gate.owner_ref))
      || !(gate.evidence_sha256===null || typeof gate.evidence_sha256==='string' && /^[a-f0-9]{64}$/.test(gate.evidence_sha256))) invalid();
    if(gate.status==='attested' && (!gate.owner_ref || !gate.evidence_sha256)) invalid();
    if(gate.status!=='attested')pending.push(key);
  }
  return {version:1,status:pending.length?'pending_inputs':'owner_review_required',pending,attestation:'caller_declared_not_independently_verified',production_ready:false,connection_authorized:false,shadow_authorized:false};
}
export function pendingSourceReadiness(){return {version:1,gates:Object.fromEntries(READINESS_GATES.map(key=>[key,{status:'pending',owner_ref:null,evidence_sha256:null}]))};}
async function main(){
  let input=pendingSourceReadiness();
  if(process.argv.length!==2){
    if(process.argv.length!==4 || process.argv[2]!=='--input')throw new Error('SOURCE_READINESS_INVALID');
    const file=await open(resolve(process.argv[3]),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      const stat=await file.stat();if(!stat.isFile() || stat.nlink!==1 || stat.uid!==process.getuid?.() || stat.mode&0o077 || stat.size>16384)throw new Error('SOURCE_READINESS_INVALID');
      const bytes=Buffer.alloc(16385);let length=0;while(length<bytes.length){const read=await file.read(bytes,length,bytes.length-length,length);if(!read.bytesRead)break;length+=read.bytesRead;}if(length>16384)throw new Error('SOURCE_READINESS_INVALID');
      input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)));
    }finally{await file.close();}
  }
  console.log(JSON.stringify(evaluateSourceReadiness(input),null,2));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('SOURCE_READINESS_INVALID');process.exitCode=1;});
