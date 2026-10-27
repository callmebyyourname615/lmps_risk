import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import formatsPlugin from 'ajv-formats';
import type { Transaction } from './generated/transaction.js';
import type { RiskAssessment } from './generated/risk-assessment.js';
import type { Alert } from './generated/alert.js';

export type { Transaction, RiskAssessment, Alert };

const ajv = new Ajv2020({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
formatsPlugin.default(ajv, { mode: 'full', formats: ['date-time'], keywords: false });

const transaction = ajv.compile<Transaction>(JSON.parse(readFileSync(new URL('../schemas/transaction.schema.json', import.meta.url), 'utf8')));
const assessment = ajv.compile<RiskAssessment>(JSON.parse(readFileSync(new URL('../schemas/risk-assessment.schema.json', import.meta.url), 'utf8')));
const alert = ajv.compile<Alert>(JSON.parse(readFileSync(new URL('../schemas/alert.schema.json', import.meta.url), 'utf8')));

export function isTransaction(value: unknown): value is Transaction {
  return transaction(value) === true;
}

export function isRiskAssessment(value: unknown): value is RiskAssessment {
  return assessment(value) === true;
}

export function isAlert(value: unknown): value is Alert {
  return alert(value) === true;
}
