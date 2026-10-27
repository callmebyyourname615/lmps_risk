import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { readConfig } from './config.js';
import { HealthController } from './health.controller.js';
import { createDatabase, createAlertReviews, createRiskPolicies, createLocalCases } from '@lmps/database';
import { POSTGRES_DATABASE, PostgresService } from './postgres.service.js';
import { randomUUID } from 'node:crypto';
import { LOCAL_AUTH, LocalAccessGuard, loadLocalAuthenticator } from './local-auth.js';
import { SourceController } from './source.controller.js';
import { OperationsController } from './operations.controller.js';
import { AuditController } from './audit.controller.js';
import { SyncController } from './sync.controller.js';
import { TransactionsController } from './transactions.controller.js';
import { TransactionRiskController } from './transaction-risk.controller.js';
import { AlertsController, AlertParsingFilter, ALERT_REVIEWS } from './alerts.controller.js';
import { AssessmentsController } from './assessments.controller.js';
import { RiskJobsController } from './risk-jobs.controller.js';
import { RiskPoliciesController, RISK_POLICIES } from './risk-policies.controller.js';
import { CasesController, LOCAL_CASES } from './cases.controller.js';
import { ModelSignalsController, MODEL_TRUST } from './model-signals.controller.js';
import { readModelTrustFile } from '@lmps/risk';
import { LabelsController,LABEL_REVIEWS } from './labels.controller.js';
import { createLabelReviews } from '@lmps/database';
import { registerPortal } from './portal.js';
import { OverviewController } from './overview.controller.js';
import { NotificationsController } from './notifications.controller.js';

export async function createApp(env: NodeJS.ProcessEnv = process.env) {
  const config = readConfig(env);
  const modelTrust = config.modelPublicKeyFile ? await readModelTrustFile(config.modelPublicKeyFile) : null;
  const auth = config.authConfig ? await loadLocalAuthenticator(config.authConfig) : null;
  const database = config.postgresDsn ? createDatabase(config.postgresDsn) : null;
  const reviews = config.reviewDsn ? createAlertReviews(config.reviewDsn) : null;
  const policies = config.policyDsn ? createRiskPolicies(config.policyDsn) : null;
  const labels = config.policyDsn ? createLabelReviews(config.policyDsn) : null;
  const cases = config.caseDsn ? createLocalCases(config.caseDsn) : null;
  @Module({
    controllers: [HealthController, ...(auth ? [NotificationsController, OverviewController, SourceController, OperationsController, AuditController, SyncController, TransactionsController, AssessmentsController, TransactionRiskController, AlertsController, RiskJobsController, RiskPoliciesController, CasesController, ModelSignalsController, LabelsController] : [])],
    providers: [PostgresService, {provide: LABEL_REVIEWS,useValue: labels}, {provide: MODEL_TRUST, useValue: modelTrust}, { provide: LOCAL_CASES, useValue: cases }, { provide: RISK_POLICIES, useValue: policies }, { provide: ALERT_REVIEWS, useValue: reviews }, ...(auth ? [LocalAccessGuard, { provide: LOCAL_AUTH, useValue: auth }] : []), { provide: POSTGRES_DATABASE, useValue: database }],
  })
  class AppModule {}
  // Request bodies/URLs can contain account data; request logging is not enabled.
  const adapter = new FastifyAdapter({ logger: false, bodyLimit: 64 * 1024, requestIdHeader: false, genReqId: () => randomUUID() });
  registerPortal(adapter.getInstance());
  adapter.getInstance().addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-ID', request.id).header('Cache-Control', 'no-store');
    return payload;
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
    abortOnError: false,
  });
  app.useGlobalFilters(new AlertParsingFilter(app.getHttpAdapter()));
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('LMPS Risk API')
      .setDescription('Local diagnostics and authenticated synthetic source, risk evidence and alert review APIs. No payment decisions.')
      .setVersion('0.0.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: '/openapi.json',
    raw: ['json'],
  });
  return { app, config };
}
