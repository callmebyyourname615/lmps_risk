import { localPoolConfig } from '@lmps/database';
import { isAbsolute } from 'node:path';

export function readConfig(env: NodeJS.ProcessEnv) {
  const config=baseConfig(env),readNamespace=env.LMPS_READ_NAMESPACE;
  if(readNamespace!==undefined&&(!/^synthetic_[a-z0-9_]{1,40}$/.test(readNamespace)||!config.authConfig||!config.postgresDsn))throw new Error('Invalid authenticated test source namespace.');
  return {...config,...(readNamespace?{readNamespace}:{})};
}
function baseConfig(env: NodeJS.ProcessEnv) {
  if (env.LMPS_WEB_PUSH_WORKER !== undefined && !["0","1"].includes(env.LMPS_WEB_PUSH_WORKER)) throw new Error("Invalid Web Push worker switch.");
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
  if (env.LMPS_WEB_PUSH_CONFIG !== undefined && (!isAbsolute(env.LMPS_WEB_PUSH_CONFIG) || !authConfig || !postgresDsn)) throw new Error("Web Push requires private config and authenticated storage.");
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
  const detectionDsn = env.LMPS_LOCAL_DETECTION_DSN;
  if (detectionDsn && (!authConfig || localPoolConfig(detectionDsn, 'intake').port !== localPoolConfig(postgresDsn!).port)) throw new Error('Local detection storage must use the authenticated app database instance.');
  if (env.LMPS_DETECTION_WORKER !== undefined && !['0', '1'].includes(env.LMPS_DETECTION_WORKER)) throw new Error('Invalid local detection worker switch.');
  if (env.LMPS_DETECTION_WORKER === '1' && !detectionDsn) throw new Error('Local detection worker needs configured intake storage.');
  if(modelPublicKeyFile!==undefined && (!isAbsolute(modelPublicKeyFile)||!authConfig))throw new Error('Model evidence requires private trust config and authenticated app reads.');
  const featureConfig = env.LMPS_LOCAL_FEATURE_CONFIG;
  const detectionFeatureContext = env.LMPS_DETECTION_FEATURE_CONTEXT === '1';
  if (env.LMPS_DETECTION_FEATURE_CONTEXT !== undefined && !['0', '1'].includes(env.LMPS_DETECTION_FEATURE_CONTEXT)
    || detectionFeatureContext && (!featureConfig || !detectionDsn)) throw new Error('Detection feature context requires explicit feature and detection configuration.');
  const offlineConfig = env.LMPS_LOCAL_OFFLINE_CONFIG, offlineDsn = env.LMPS_LOCAL_OFFLINE_DSN;
  if (offlineConfig !== undefined || offlineDsn !== undefined) {
    if (!offlineConfig || !isAbsolute(offlineConfig) || !offlineDsn || !authConfig || !postgresDsn
      || localPoolConfig(offlineDsn, 'intake').port !== localPoolConfig(postgresDsn).port)
      throw new Error('Offline monitoring requires an explicit private grant and authenticated same-instance intake storage.');
  }
  if (Object.keys(env).some(k => k.startsWith('LMPS_LOCAL_FEATURE_') && k !== 'LMPS_LOCAL_FEATURE_CONFIG') || (featureConfig !== undefined && (!isAbsolute(featureConfig) || !authConfig))) throw new Error('Invalid local feature configuration.');
  return { detectionFeatureContext, ...(offlineConfig ? { offlineConfig, offlineDsn } : {}), ...(featureConfig ? { featureConfig } : {}), ...(detectionDsn ? { detectionDsn, detectionWorker: env.LMPS_DETECTION_WORKER !== '0' } : {}), ...(modelPublicKeyFile ? {modelPublicKeyFile} : {}), ...(caseDsn ? { caseDsn } : {}), ...(policyDsn ? { policyDsn } : {}), ...(reviewDsn ? { reviewDsn } : {}), environment, executionMode: 'test' as const, port, ...(postgresDsn ? { postgresDsn } : {}), ...(authConfig ? { authConfig } : {}) };
}
