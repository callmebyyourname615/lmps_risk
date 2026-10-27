import { RISK_CODES, type Locale, type RiskCode, type RiskDimension, type RiskFinding, type TransactionRiskResult } from '@lmps/contracts/transaction-risk';

export const RISK_ENGINE_VERSION = 'synthetic-risk-0.1.0-draft.1';
export const RISK_CATALOG_VERSION = 'risk-catalog-lo-en-0.1.0-draft.1';
export interface RiskText { title: string; definition: string; condition: string; limitation: string }
type Entry = { code: RiskCode; dimension: RiskDimension; unit: 'amount' | 'count' | 'basis_points'; requires: string[]; translations: Record<Locale, RiskText> };
const entries: Array<[RiskCode, RiskDimension, Entry['unit'], string[], [string, string, string, string], [string, string, string, string]]> = [
  ['FRAUD_HIGH_AMOUNT', 'fraud', 'amount', [],
    ['High transaction amount', 'Executed amount remaining after declared reversals.', 'Net amount meets the configured currency-specific threshold.', 'A high amount alone does not establish fraud.'],
    ['ຍອດທຸລະກຳສູງ', 'ຍອດທີ່ສຳເລັດຫຼັງຫັກຍອດຄືນທີ່ລະບຸ.', 'ຍອດສຸດທິຮອດເກນຂອງສະກຸນເງິນທີ່ກຳນົດ.', 'ຍອດສູງພຽງຢ່າງດຽວບໍ່ຢືນຢັນການສໍ້ໂກງ.']],
  ['FRAUD_COUNT_VELOCITY', 'fraud', 'count', ['identity', 'history'],
    ['Frequent outgoing transfers', 'Number of executed outgoing payments from the sender within the window.', 'Payment count including this revision meets the configured threshold.', 'Failed, pending and fully reversed payments do not contribute.'],
    ['ໂອນອອກຖີ່', 'ຈຳນວນລາຍການໂອນອອກທີ່ສຳເລັດຂອງຜູ້ສົ່ງໃນຊ່ວງເວລາ.', 'ຈຳນວນລາຍການລວມລາຍການນີ້ຮອດເກນທີ່ກຳນົດ.', 'ບໍ່ນັບລາຍການລົ້ມເຫຼວ, ລໍຖ້າ ຫຼື ຄືນເງິນທັງໝົດ.']],
  ['FRAUD_AMOUNT_VELOCITY', 'fraud', 'amount', ['identity', 'history'],
    ['High outgoing window total', 'Sum of net executed outgoing amounts in one currency.', 'Window total including this payment meets the configured threshold.', 'No currency conversion or balance inference is performed.'],
    ['ຍອດໂອນລວມສູງໃນຊ່ວງເວລາ', 'ຜົນລວມຍອດໂອນອອກສຸດທິທີ່ສຳເລັດໃນສະກຸນເງິນດຽວ.', 'ຍອດລວມທີ່ລວມລາຍການນີ້ຮອດເກນທີ່ກຳນົດ.', 'ບໍ່ແປງສະກຸນເງິນ ຫຼື ຄາດເດົາຍອດຄົງເຫຼືອ.']],
  ['FRAUD_NEW_COUNTERPARTY', 'fraud', 'count', ['identity', 'history', 'baseline'],
    ['New observed counterparty', 'The receiver has no earlier executed payment from this sender in the covered history.', 'The new-counterparty indicator (0 or1) meets the configured threshold.', 'First observed does not mean a newly opened account.'],
    ['ຄູ່ທຸລະກຳທີ່ພົບໃໝ່', 'ບໍ່ພົບການໂອນທີ່ສຳເລັດຈາກຜູ້ສົ່ງໄປຜູ້ຮັບນີ້ກ່ອນໜ້າໃນປະຫວັດທີ່ຄອບຄຸມ.', 'ຕົວຊີ້ວັດຄູ່ທຸລະກຳໃໝ່ (0 ຫຼື 1) ຮອດເກນ.', 'ການພົບເທື່ອທຳອິດບໍ່ໝາຍເຖິງບັນຊີເປີດໃໝ່.']],
  ['FRAUD_AMOUNT_DEVIATION', 'fraud', 'basis_points', ['identity', 'history', 'baseline'],
    ['Amount above historical baseline', 'Current net amount divided by the mean outgoing amount in the prior baseline period.', 'Ratio in basis points meets the configured threshold;10000 equals the baseline.', 'An empty or zero baseline is unavailable, not a zero-risk result.'],
    ['ຍອດເງິນຜິດຈາກຄ່າຖານ', 'ຍອດສຸດທິປັດຈຸບັນທຽບກັບຍອດໂອນອອກສະເລ່ຍໃນຊ່ວງຄ່າຖານກ່ອນໜ້າ.', 'ອັດຕາໃນໜ່ວຍ basis points ຮອດເກນ; 10000 ເທົ່າກັບຄ່າຖານ.', 'ຖ້າຄ່າຖານຫວ່າງ ຫຼື ເປັນສູນ ຈະປະເມີນບໍ່ໄດ້.']],
  ['FRAUD_FREQUENCY_DEVIATION', 'fraud', 'basis_points', ['identity', 'history', 'baseline'],
    ['Frequency above historical baseline', 'Window payment count divided by the mean count per equal baseline window.', 'Frequency ratio in basis points meets the configured threshold.', 'Baseline windows require explicit complete coverage.'],
    ['ຄວາມຖີ່ຜິດຈາກຄ່າຖານ', 'ຈຳນວນລາຍການໃນຊ່ວງປັດຈຸບັນທຽບກັບຈຳນວນສະເລ່ຍຕໍ່ຊ່ວງຄ່າຖານທີ່ຍາວເທົ່າກັນ.', 'ອັດຕາຄວາມຖີ່ໃນ basis points ຮອດເກນ.', 'ຕ້ອງມີຫຼັກຖານວ່າປະຫວັດຄອບຄຸມຊ່ວງຄ່າຖານ.']],
  ['MULE_FAN_IN', 'mule_network', 'count', ['identity', 'history'],
    ['Many senders to one receiver', 'Distinct senders paying this receiver in the window.', 'Distinct sender count meets the configured threshold.', 'Distinctness uses declared synthetic identities only.'],
    ['ຮັບເງິນຈາກຫຼາຍບັນຊີ', 'ຈຳນວນຜູ້ສົ່ງທີ່ແຕກຕ່າງກັນທີ່ໂອນໃຫ້ຜູ້ຮັບນີ້ໃນຊ່ວງເວລາ.', 'ຈຳນວນຜູ້ສົ່ງຮອດເກນທີ່ກຳນົດ.', 'ໃຊ້ສະເພາະຕົວຕົນສັງເຄາະທີ່ລະບຸໄວ້.']],
  ['MULE_FAN_OUT', 'mule_network', 'count', ['identity', 'history'],
    ['One sender to many receivers', 'Distinct receivers paid by this sender in the window.', 'Distinct receiver count meets the configured threshold.', 'Network coverage can be incomplete outside this fixture.'],
    ['ກະຈາຍເງິນໄປຫຼາຍບັນຊີ', 'ຈຳນວນຜູ້ຮັບທີ່ແຕກຕ່າງກັນທີ່ຜູ້ສົ່ງນີ້ໂອນໃຫ້ໃນຊ່ວງເວລາ.', 'ຈຳນວນຜູ້ຮັບຮອດເກນທີ່ກຳນົດ.', 'ຂໍ້ມູນນອກຊຸດສັງເຄາະນີ້ອາດບໍ່ຄົບຖ້ວນ.']],
  ['MULE_RAPID_PASS_THROUGH', 'mule_network', 'basis_points', ['identity', 'history'],
    ['Rapid receipt and forwarding proxy', 'Outgoing net total since the first earlier receipt divided by received net total in the window.', 'Receipts meet the minimum amount and forwarding ratio meets the configured threshold.', 'Temporal proximity and ratio do not prove the same funds were forwarded.'],
    ['ຮັບແລ້ວໂອນຕໍ່ຢ່າງໄວ', 'ຍອດໂອນອອກສຸດທິຕັ້ງແຕ່ການຮັບກ່ອນໜ້າ ທຽບກັບຍອດຮັບສຸດທິໃນຊ່ວງເວລາ.', 'ຍອດຮັບຮອດຍອດຂັ້ນຕ່ຳ ແລະ ອັດຕາໂອນຕໍ່ຮອດເກນ.', 'ເວລາໃກ້ກັນແລະອັດຕາສ່ວນບໍ່ຢືນຢັນວ່າເປັນເງິນກ້ອນດຽວກັນ.']],
  ['MULE_NETWORK_CYCLE', 'mule_network', 'count', ['identity', 'history', 'graph'],
    ['Temporal payment cycle', 'A bounded time-ordered path closes a cycle with this payment.', 'Cycle length in hops meets the configured threshold.', 'Search depth and work are bounded; a limit returns unavailable.'],
    ['ເສັ້ນທາງເງິນວົນກັບ', 'ເສັ້ນທາງທີ່ຮຽງຕາມເວລາປິດເປັນວົງດ້ວຍລາຍການນີ້ພາຍໃນຂອບເຂດຄົ້ນຫາ.', 'ຈຳນວນຂັ້ນຂອງວົງຮອດເກນ.', 'ຖ້າເກີນຂອບເຂດຄົ້ນຫາ ຈະລະບຸວ່າປະເມີນບໍ່ໄດ້.']],
  ['MULE_FLAGGED_NEIGHBOR', 'mule_network', 'count', ['identity', 'history', 'flags'],
    ['Connection to a flagged synthetic account', 'Distinct direct counterparties in an explicitly supplied versioned synthetic flag set.', 'Flagged direct-neighbor count meets the configured threshold.', 'A supplied flag is a test signal, not a sanctions match or confirmed criminal label.'],
    ['ເຊື່ອມໂຍງກັບບັນຊີສັງເຄາະທີ່ມີສັນຍານ', 'ຄູ່ທຸລະກຳໂດຍກົງທີ່ຢູ່ໃນຊຸດສັນຍານສັງເຄາະທີ່ລະບຸລຸ້ນໄວ້.', 'ຈຳນວນຄູ່ທຸລະກຳທີ່ມີສັນຍານຮອດເກນ.', 'ສັນຍານທົດສອບບໍ່ແມ່ນຜົນກວດລາຍຊື່ຄວ່ຳບາດ ຫຼື ການຢືນຢັນອາຊະຍາກຳ.']],
  ['AML_STRUCTURING_PATTERN', 'aml', 'count', ['identity', 'history'],
    ['Cluster of payments below a configured ceiling', 'Sender payments near but below an explicitly configured synthetic ceiling, with combined amount at least that ceiling.', 'This payment belongs to the near-ceiling cluster and its count meets the configured threshold.', 'This pattern does not prove intent to evade a legal reporting requirement.'],
    ['ຮູບແບບແບ່ງຍອດຕ່ຳກວ່າເພດານ', 'ຫຼາຍລາຍການຂອງຜູ້ສົ່ງມີຍອດໃກ້ແຕ່ຕ່ຳກວ່າເພດານສັງເຄາະ ແລະ ຍອດລວມຮອດເພດານ.', 'ລາຍການນີ້ຢູ່ໃນກຸ່ມດັ່ງກ່າວ ແລະ ຈຳນວນຮອດເກນ.', 'ຮູບແບບນີ້ບໍ່ຢືນຢັນເຈດຕະນາຫຼີກລ່ຽງຂໍ້ກຳນົດລາຍງານຕາມກົດໝາຍ.']],
  ['AML_REPEATED_HIGH_VALUE', 'aml', 'count', ['identity', 'history'],
    ['Repeated high-value payments', 'Outgoing payments meeting the configured minimum amount in the window.', 'This payment is high-value and the repeated-payment count meets the threshold.', 'The minimum amount is a synthetic policy parameter, not a legal threshold.'],
    ['ໂອນຍອດສູງຊ້ຳ', 'ລາຍການໂອນອອກທີ່ຮອດຍອດຂັ້ນຕ່ຳທີ່ກຳນົດໃນຊ່ວງເວລາ.', 'ລາຍການນີ້ມີຍອດສູງ ແລະ ຈຳນວນລາຍການຊ້ຳຮອດເກນ.', 'ຍອດຂັ້ນຕ່ຳເປັນຄ່ານະໂຍບາຍສັງເຄາະ ບໍ່ແມ່ນເກນກົດໝາຍ.']],
  ['AML_MULTI_HOP_FLOW', 'aml', 'count', ['identity', 'history', 'graph'],
    ['Time-ordered multi-hop flow proxy', 'Longest bounded chain of distinct accounts ending in this payment.', 'Chain length in hops meets the configured threshold.', 'A path shows observed transfers, not proof that a single sum of money traversed them.'],
    ['ເສັ້ນທາງເງິນຫຼາຍຂັ້ນ', 'ເສັ້ນທາງບັນຊີທີ່ແຕກຕ່າງກັນແລະຮຽງຕາມເວລາ ທີ່ສິ້ນສຸດດ້ວຍລາຍການນີ້.', 'ຈຳນວນຂັ້ນຂອງເສັ້ນທາງຮອດເກນ.', 'ບໍ່ຢືນຢັນວ່າເງິນກ້ອນດຽວກັນໄຫຼຜ່ານທຸກຂັ້ນ.']],
  ['AML_NETWORK_DEVIATION', 'aml', 'basis_points', ['identity', 'history', 'baseline'],
    ['Counterparty breadth above baseline', 'Current distinct outgoing counterparties divided by mean distinct counterparties per prior equal window.', 'Breadth ratio in basis points meets the configured threshold.', 'A zero baseline is unavailable; observed network coverage is explicitly bounded.'],
    ['ຈຳນວນຄູ່ທຸລະກຳຜິດຈາກຄ່າຖານ', 'ຈຳນວນຜູ້ຮັບທີ່ແຕກຕ່າງໃນຊ່ວງປັດຈຸບັນ ທຽບກັບຄ່າສະເລ່ຍຕໍ່ຊ່ວງຄ່າຖານກ່ອນໜ້າ.', 'ອັດຕາຈຳນວນຄູ່ທຸລະກຳໃນ basis points ຮອດເກນ.', 'ຖ້າຄ່າຖານເປັນສູນ ຈະປະເມີນບໍ່ໄດ້; ຂອບເຂດເຄືອຂ່າຍມີຈຳກັດ.']],
];
const text = ([title, definition, condition, limitation]: string[]): RiskText => ({ title: title!, definition: definition!, condition: condition!, limitation: limitation! });
export const RISK_CATALOG: readonly Entry[] = entries.map(([code, dimension, unit, requires, en, lo]) => ({ code, dimension, unit, requires, translations: { en: text(en), lo: text(lo) } }));
if (new Set(RISK_CATALOG.map(e => e.code)).size !== RISK_CODES.length) throw new Error('Incomplete risk catalog.');

const messages = {
  PATTERN_THRESHOLD_MET: ['Configured pattern threshold met.', 'ຮູບແບບຮອດເກນທີ່ກຳນົດ.'],
  PATTERN_THRESHOLD_NOT_MET: ['Configured pattern threshold not met.', 'ຮູບແບບຍັງບໍ່ຮອດເກນທີ່ກຳນົດ.'],
  POLICY_NOT_CONFIGURED: ['No synthetic scoring policy was supplied.', 'ບໍ່ໄດ້ລະບຸນະໂຍບາຍຄະແນນສັງເຄາະ.'],
  RULE_DISABLED: ['This detector is disabled by the supplied policy.', 'ນະໂຍບາຍທີ່ລະບຸປິດການກວດປະເພດນີ້.'],
  INPUT_MISSING: ['The requested transaction revision was not found.', 'ບໍ່ພົບລຸ້ນທຸລະກຳທີ່ຮ້ອງຂໍ.'],
  INPUT_INVALID: ['Transaction evidence failed validation.', 'ຫຼັກຖານທຸລະກຳບໍ່ຜ່ານການກວດສອບ.'],
  INPUT_NOT_NORMALIZED: ['Usable normalization evidence is not available.', 'ຍັງບໍ່ມີຫຼັກຖານການປັບຂໍ້ມູນທີ່ໃຊ້ໄດ້.'],
  CURRENCY_OUT_OF_SCOPE: ['Currency is outside this policy.', 'ສະກຸນເງິນຢູ່ນອກຂອບເຂດນະໂຍບາຍນີ້.'],
  TRANSACTION_NOT_EXECUTED: ['No net executed amount exists in this monitoring profile.', 'ບໍ່ມີຍອດສຸດທິທີ່ສຳເລັດໃນຮູບແບບຕິດຕາມນີ້.'],
  CONTEXT_NOT_PROVIDED: ['A synthetic history context was not supplied.', 'ບໍ່ໄດ້ລະບຸຂໍ້ມູນປະຫວັດສັງເຄາະ.'],
  IDENTITY_UNVERIFIED: ['Declared synthetic account identities are required.', 'ຕ້ອງມີຕົວຕົນບັນຊີສັງເຄາະທີ່ລະບຸຊັດເຈນ.'],
  HISTORY_INCOMPLETE: ['History does not cover the required time interval.', 'ປະຫວັດບໍ່ຄອບຄຸມຊ່ວງເວລາທີ່ຕ້ອງການ.'],
  TARGET_NOT_IN_HISTORY: ['The pinned target revision is missing from usable history.', 'ບໍ່ພົບລຸ້ນເປົ້າໝາຍໃນປະຫວັດທີ່ໃຊ້ໄດ້.'],
  BASELINE_UNAVAILABLE: ['The required nonzero baseline is unavailable.', 'ບໍ່ມີຄ່າຖານທີ່ບໍ່ແມ່ນສູນຕາມທີ່ຕ້ອງການ.'],
  FLAGS_UNAVAILABLE: ['A versioned synthetic flag set was not supplied.', 'ບໍ່ໄດ້ລະບຸຊຸດສັນຍານສັງເຄາະທີ່ມີລຸ້ນ.'],
  GRAPH_LIMIT_EXCEEDED: ['Graph work exceeded its safe bounded search budget.', 'ການຄົ້ນຫາເຄືອຂ່າຍເກີນຂອບເຂດທີ່ກຳນົດ.'],
  PATTERN_OUT_OF_SCOPE: ['This payment is outside the specific pattern prerequisites.', 'ລາຍການນີ້ບໍ່ເຂົ້າເງື່ອນໄຂພື້ນຖານຂອງຮູບແບບນີ້.'],
  SCORE_AVAILABLE: ['Weighted binary-signal index within the evaluated scope; not a probability.', 'ດັດຊະນີຈາກສັນຍານແລະນ້ຳໜັກໃນຂອບເຂດທີ່ປະເມີນ; ບໍ່ແມ່ນຄວາມນ່າຈະເປັນ.'],
  SCORE_INCOMPLETE: ['Required detector inputs are unavailable; score remains null.', 'ຂໍ້ມູນທີ່ຈຳເປັນບໍ່ພ້ອມ; ຄະແນນຍັງເປັນ null.'],
  NO_APPLICABLE_RULES: ['No enabled applicable detector was evaluated.', 'ບໍ່ມີການປະເມີນກົດທີ່ເປີດໃຊ້ແລະເຂົ້າຂອບເຂດ.'],
  NO_ENFORCEMENT_POLICY: ['No payment action is authorized by this synthetic assessment.', 'ຜົນປະເມີນສັງເຄາະນີ້ບໍ່ອະນຸຍາດໃຫ້ດຳເນີນການກັບການຊຳລະເງິນ.'],
  RISK_SIGNALS_DETECTED: ['One or more configured risk signals were detected.', 'ພົບສັນຍານຄວາມສ່ຽງຕາມເງື່ອນໄຂທີ່ກຳນົດ.'],
  NO_SIGNAL_IN_EVALUATED_SCOPE: ['No signal was detected in the evaluated scope; this is not a safety guarantee.', 'ບໍ່ພົບສັນຍານໃນຂອບເຂດທີ່ປະເມີນ; ບໍ່ແມ່ນການຮັບປະກັນຄວາມປອດໄພ.'],
  RISK_ASSESSMENT_PARTIAL: ['Only part of the configured scope could be evaluated.', 'ປະເມີນໄດ້ພຽງບາງສ່ວນຂອງຂອບເຂດທີ່ກຳນົດ.'],
  RISK_ASSESSMENT_UNAVAILABLE: ['Required inputs prevent assessment of the configured scope.', 'ຂໍ້ມູນທີ່ຈຳເປັນບໍ່ພ້ອມສຳລັບປະເມີນຂອບເຂດທີ່ກຳນົດ.'],
  RISK_NOT_EVALUATED: ['Risk assessment was not enabled or configured.', 'ບໍ່ໄດ້ເປີດ ຫຼື ກຳນົດການປະເມີນຄວາມສ່ຽງ.'],
  RISK_NOT_APPLICABLE: ['This payment is outside the enabled monitoring scope.', 'ລາຍການນີ້ຢູ່ນອກຂອບເຂດການຕິດຕາມທີ່ເປີດໃຊ້.'],
  RISK_INPUT_INVALID: ['Invalid synthetic risk input; details withheld.', 'ຂໍ້ມູນປະເມີນສັງເຄາະບໍ່ຖືກຕ້ອງ; ບໍ່ສະແດງລາຍລະອຽດພາຍໃນ.'],
  RISK_CONTEXT_CONFLICT: ['Synthetic context does not match the pinned transaction evidence.', 'ຂໍ້ມູນສັງເຄາະບໍ່ກົງກັບຫຼັກຖານຂອງລຸ້ນທຸລະກຳ.'],
  RISK_RUN_CONFLICT: ['Run ID already belongs to a different request.', 'ລະຫັດການປະເມີນນີ້ຖືກໃຊ້ກັບຄຳຮ້ອງອື່ນແລ້ວ.'],
  RISK_POLICY_CONFLICT: ['Policy version already belongs to different content.', 'ລຸ້ນນະໂຍບາຍນີ້ມີເນື້ອໃນອື່ນຢູ່ແລ້ວ.'],
  RISK_STORAGE_UNAVAILABLE: ['Risk storage or frozen evidence is unavailable.', 'ບໍ່ສາມາດໃຊ້ບ່ອນເກັບຜົນ ຫຼື ຫຼັກຖານທີ່ບັນທຶກໄວ້.'],
  INVALID_QUERY: ['Invalid risk query.', 'ຄຳຮ້ອງຄົ້ນຫາຄວາມສ່ຽງບໍ່ຖືກຕ້ອງ.'],
  UNAUTHORIZED: ['A valid access token is required.', 'ຕ້ອງມີລະຫັດສິດເຂົ້າໃຊ້ທີ່ຖືກຕ້ອງ.'],
  FORBIDDEN: ['Access to this risk scope is not permitted.', 'ບໍ່ມີສິດເຂົ້າເຖິງຂອບເຂດຄວາມສ່ຽງນີ້.'],
} as const;
export function riskMessage(code: string, locale: Locale): string { return (messages[code as keyof typeof messages] ?? messages.RISK_STORAGE_UNAVAILABLE)[locale === 'lo' ? 1 : 0]; }
export function selectRiskLocale(header: unknown): Locale {
  if (header === undefined) return 'lo';
  if (typeof header !== 'string' || header.length > 256) return 'en';
  const choices = header.toLowerCase().split(',').map((part, index) => {
    const match = /^\s*([a-z]{2}(?:-[a-z0-9]{1,8})*|\*)(?:\s*;\s*q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/.exec(part);
    const base = match?.[1]?.split('-')[0];
    return { locale: base === 'la' ? 'lo' : base, q: match ? Number(match[2] ?? 1) : 0, index };
  }).sort((a, b) => b.q - a.q || a.index - b.index);
  for (const choice of choices) if (choice.q > 0 && (choice.locale === 'lo' || choice.locale === 'en')) return choice.locale;
  return 'en';
}
export function localizedRiskCatalog(locale: Locale) {
  return { catalog_version: RISK_CATALOG_VERSION, locale, supported_locales: ['lo', 'en'], aliases: { la: 'lo' },
    score_semantics: riskMessage('SCORE_AVAILABLE', locale),
    units: [
      { code: 'amount', label: locale === 'lo' ? 'ຍອດເງິນໃນສະກຸນທີ່ກຳນົດ' : 'Amount in the configured currency' },
      { code: 'count', label: locale === 'lo' ? 'ຈຳນວນ' : 'Count' },
      { code: 'basis_points', label: locale === 'lo' ? 'ອັດຕາສ່ວນ; 10000 ເທົ່າກັບ 1 ເທົ່າ' : 'Ratio;10000 equals1×' },
    ],
    dimensions: [
      { code: 'fraud', title: locale === 'lo' ? 'ຄວາມສ່ຽງການສໍ້ໂກງ' : 'Fraud risk' },
      { code: 'mule_network', title: locale === 'lo' ? 'ຄວາມສ່ຽງເຄືອຂ່າຍບັນຊີທາງຜ່ານ' : 'Mule network risk' },
      { code: 'aml', title: locale === 'lo' ? 'ສັນຍານສົງໄສການຟອກເງິນ' : 'AML suspicion signals' },
    ],
    risk_types: RISK_CATALOG.map(({ translations, ...entry }) => ({ ...entry, ...translations[locale] })),
    codes: Object.entries(messages).map(([code]) => ({ code, definition: riskMessage(code, locale) })),
    statuses: Object.entries({ available: ['Available', 'ພ້ອມໃຊ້'], triggered: ['Threshold met', 'ຮອດເກນ'], not_triggered: ['Threshold not met', 'ບໍ່ຮອດເກນ'], unavailable: ['Data unavailable', 'ຂໍ້ມູນບໍ່ພ້ອມ'],
      not_evaluated: ['Not evaluated', 'ຍັງບໍ່ປະເມີນ'], not_applicable: ['Outside scope', 'ຢູ່ນອກຂອບເຂດ'], complete: ['Evaluation complete', 'ປະເມີນຄົບ'], partial: ['Partial evaluation', 'ປະເມີນບາງສ່ວນ'],
      low: ['Low index', 'ດັດຊະນີຕ່ຳ'], medium: ['Medium index', 'ດັດຊະນີປານກາງ'], high: ['High index', 'ດັດຊະນີສູງ'], critical: ['Critical index', 'ດັດຊະນີສູງຫຼາຍ'] })
      .map(([code, labels]) => ({ code, label: labels[locale === 'lo' ? 1 : 0] })) };
}
export function localizeRiskResult(result: TransactionRiskResult, locale: Locale) {
  return { ...result, locale, response_message: riskMessage(result.response_code, locale),
    score_messages: Object.fromEntries((['fraud_score', 'mule_network_score', 'aml_suspicion_score'] as const).map(key => [key, riskMessage(result[key].reason_code, locale)])),
    findings: result.findings.map((finding: RiskFinding) => ({ ...finding, ...RISK_CATALOG.find(e => e.code === finding.code)!.translations[locale], reason: riskMessage(finding.reason_code, locale) })),
    decision: { ...result.decision, reason: riskMessage(result.decision.reason_code, locale) } };
}
