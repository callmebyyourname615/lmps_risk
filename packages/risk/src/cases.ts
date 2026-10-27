import { isDeepStrictEqual } from 'node:util';
import {
  CASE_MAX_COMMAND_BYTES,
  isCaseCommand,
  type CaseCommand,
  type CaseErrorCode,
} from '@lmps/contracts/local-case';
import { alertLocalMode } from './alerts.js';
export type * from '@lmps/contracts/local-case';
export { CASE_MAX_ALERTS, CASE_MAX_EVENTS, CASE_STATES, caseCommandSchema } from '@lmps/contracts/local-case';
export class CaseError extends Error {
  constructor(readonly code: CaseErrorCode) {
    super(code);
    this.name = 'CaseError';
  }
}
export function caseIdentity(workspace: unknown, id?: unknown) {
  try {
    alertLocalMode();
  } catch {
    throw new CaseError('CASE_INVALID_INPUT');
  }
  if (
    typeof workspace !== 'string' ||
    !/^synthetic_[a-z0-9_]{1,40}$/.test(workspace) ||
    (id !== undefined &&
      (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)))
  )
    throw new CaseError('CASE_INVALID_INPUT');
}
function text(value: string) {
  if (!value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value))
    throw new CaseError('CASE_INVALID_INPUT');
}
export function validateCaseCommand(value: unknown): CaseCommand {
  try {
    caseIdentity('synthetic_local');
    const command = structuredClone(value);
    if (
      Buffer.byteLength(JSON.stringify(command)) > CASE_MAX_COMMAND_BYTES ||
      !isCaseCommand(command) ||
      !isDeepStrictEqual(command, JSON.parse(JSON.stringify(command)))
    )
      throw new Error();
    text(command.note);
    if (command.action === 'create') {
      text(command.title);
      if (command.expected_version !== 0) throw new Error();
    } else if (command.expected_version < 1) throw new Error();
    if (command.action === 'record_outcome')
      for (const dimension of Object.values(command.dimensions)) text(dimension.rationale);
    return command;
  } catch {
    throw new CaseError('CASE_INVALID_INPUT');
  }
}
const messages: Record<string, [string, string]> = {
  CASE_INVALID_INPUT: ['Invalid case request.', 'ຄຳຂໍກໍລະນີບໍ່ຖືກຕ້ອງ'],
  CASE_NOT_FOUND: ['Case not found in this workspace.', 'ບໍ່ພົບກໍລະນີໃນພື້ນທີ່ນີ້'],
  CASE_ALERT_NOT_FOUND: ['Alert evidence not found in this workspace.', 'ບໍ່ພົບຫຼັກຖານແຈ້ງເຕືອນໃນພື້ນທີ່ນີ້'],
  CASE_CONFLICT: ['Case changed or request ID conflicts; reload before retrying.', 'ກໍລະນີປ່ຽນແລ້ວ ກະລຸນາໂຫຼດໃໝ່'],
  CASE_ALERT_ALREADY_LINKED: ['Alert already belongs to a case; use its existing case.', 'ການແຈ້ງເຕືອນນີ້ມີກໍລະນີແລ້ວ'],
  CASE_INVALID_TRANSITION: ['Case transition is not allowed.', 'ບໍ່ອະນຸຍາດໃຫ້ປ່ຽນສະຖານະກໍລະນີນີ້'],
  CASE_NOT_ASSIGNEE: ['This action requires the assigned reviewer.', 'ການດຳເນີນການນີ້ຕ້ອງແມ່ນຜູ້ກວດສອບທີ່ຖືກມອບໝາຍ'],
  CASE_OUTCOME_REQUIRED: [
    'Record current outcomes for all three dimensions before closing.',
    'ຕ້ອງບັນທຶກຜົນປັດຈຸບັນທັງສາມດ້ານກ່ອນປິດ',
  ],
  CASE_LIMIT_REACHED: ['Bounded case evidence/history limit reached.', 'ຮອດຂອບເຂດຫຼັກຖານຫຼືປະຫວັດກໍລະນີແລ້ວ'],
  CASE_STORAGE_UNAVAILABLE: ['Case evidence is unavailable; diagnostics withheld.', 'ຫຼັກຖານກໍລະນີບໍ່ພ້ອມ'],
  CASE_WRITES_NOT_CONFIGURED: ['Case write storage is not configured.', 'ຍັງບໍ່ຕັ້ງຄ່າບ່ອນບັນທຶກກໍລະນີ'],
};
export const caseMessage = (code: string, locale: 'lo' | 'en') =>
  (messages[code] ?? messages.CASE_STORAGE_UNAVAILABLE)![locale === 'en' ? 0 : 1];
