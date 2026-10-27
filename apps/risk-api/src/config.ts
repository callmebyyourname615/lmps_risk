import { localPoolConfig } from '@lmps/database';
import { isAbsolute } from 'node:path';

export function readConfig(env: NodeJS.ProcessEnv) {
  const environment = env.LMPS_ENVIRONMENT ?? 'local';
  if (env.NODE_ENV === 'production' || !['local', 'test'].includes(environment)) {
    throw new Error('This bootstrap API supports local/test environments only.');
  }
  if ((env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') {
    throw new Error('This bootstrap API supports test execution mode only.');
  }
  const rawPort = env.LMPS_API_PORT ?? '18501';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('LMPS_API_PORT must be an integer between 1 and 65535.');
  }
  const postgresDsn = env.LMPS_POSTGRES_DSN;
  if (postgresDsn) localPoolConfig(postgresDsn);
  const authConfig = env.LMPS_LOCAL_AUTH_CONFIG;
  if (authConfig !== undefined && (!isAbsolute(authConfig) || !postgresDsn)) throw new Error('Local source authentication requires an absolute private config path and app database.');
  const reviewDsn = env.LMPS_LOCAL_REVIEW_DSN;
  if (reviewDsn) {
    if (!authConfig) throw new Error('Local review storage requires authenticated app reads.');
    if (localPoolConfig(reviewDsn, 'reviewer').port !== localPoolConfig(postgresDsn!).port) throw new Error('Local review storage must use the app database instance.');
  }
  const policyDsn = env.LMPS_LOCAL_POLICY_DSN;
  if (policyDsn) {
    if (!authConfig) throw new Error('Local policy storage requires authenticated app reads.');
    if (localPoolConfig(policyDsn, 'policy').port !== localPoolConfig(postgresDsn!).port) throw new Error('Local policy storage must use the app database instance.');
  }
  const caseDsn = env.LMPS_LOCAL_CASE_DSN;
  if (caseDsn) {
    if (!authConfig) throw new Error('Local case storage requires authenticated app reads.');
    if (localPoolConfig(caseDsn, 'case').port !== localPoolConfig(postgresDsn!).port) throw new Error('Local case storage must use the app database instance.');
  }
  const modelPublicKeyFile=env.LMPS_ML_PUBLIC_KEY_FILE;
  if(modelPublicKeyFile!==undefined && (!isAbsolute(modelPublicKeyFile)||!authConfig))throw new Error('Model evidence requires private trust config and authenticated app reads.');
  return { ...(modelPublicKeyFile ? {modelPublicKeyFile} : {}), ...(caseDsn ? { caseDsn } : {}), ...(policyDsn ? { policyDsn } : {}), ...(reviewDsn ? { reviewDsn } : {}), environment, executionMode: 'test' as const, port, ...(postgresDsn ? { postgresDsn } : {}), ...(authConfig ? { authConfig } : {}) };
}
