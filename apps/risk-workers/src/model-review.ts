import { createModelSignals } from '@lmps/database';
import { ModelSignalError, readModelPrivateFile, readModelTrustFile, validateModelGateRequest, verifyShadowResult } from '@lmps/risk';

export async function reviewWithModel(input: unknown, config: { dsn: string; endpoint: string; token_file: string; public_key_file: string; timeout_ms?: number }) {
  const request = validateModelGateRequest(input), trust = await readModelTrustFile(config.public_key_file);
  const url = new URL(config.endpoint), timeout = config.timeout_ms ?? 1500;
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/v1/shadow/score' || url.username || url.password || url.search || url.hash
    || !Number.isInteger(timeout) || timeout < 1 || timeout > 5000) throw new ModelSignalError('ML_INVALID_INPUT');
  const token = await readModelPrivateFile(config.token_file,64);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new ModelSignalError('ML_INVALID_INPUT');
  const repository = createModelSignals(config.dsn,trust);
  try {
    const prepared = await repository.prepare(request);
    if (prepared.existing) return {status:'duplicate' as const,view:prepared.existing};
    const features = prepared.features!; let reply: unknown | null = null, response: Response;
    try {
      response = await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(features),redirect:'error',signal:AbortSignal.timeout(timeout)});
    } catch { return await repository.record(request,null); }
    if (![200,503].includes(response.status)) { await response.body?.cancel(); throw new ModelSignalError('ML_PROOF_INVALID'); }
    const reader = response.body?.getReader();
    if (!reader) throw new ModelSignalError('ML_PROOF_INVALID');
    const chunks: Uint8Array[] = []; let size=0;
    try {
      while (true) { const r=await reader.read(); if (r.done) break; size+=r.value.length; if (size>16384) throw new ModelSignalError('ML_PROOF_INVALID'); chunks.push(r.value); }
      reply=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    } catch (error) { if (error instanceof ModelSignalError) throw error; throw new ModelSignalError('ML_PROOF_INVALID'); }
    finally { await reader.cancel().catch(()=>{}); }
    // An authenticated service timeout is explicit unavailability. Other malformed replies fail closed.
    if (response.status===503 && reply && typeof reply==='object' && Object.keys(reply).join(',')==='code'
      && 'code' in reply && ['ML_TIMEOUT','ML_BUSY','ML_UNAVAILABLE'].includes(String(reply.code))) return await repository.record(request,null);
    const signed=verifyShadowResult(reply,features,trust);
    if ((signed.status==='available')!==(response.status===200)) throw new ModelSignalError('ML_PROOF_INVALID');
    return await repository.record(request,signed);
  } finally { await repository.close(); }
}
