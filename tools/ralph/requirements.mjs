import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './state.mjs';

const PHASES = {
  P00: { paths: ['package.json', 'ci/verify.py', 'docs/architecture/engineering-foundation-gates.md'], gate: 'Named owners, SLOs, approved platform/legal/publication and hosted evidence.', dependencies: 'Approved foundation scope' },
  P01: { paths: ['packages/source-preflight/src', 'apps/risk-workers/scripts/source-semantics.mjs', 'docs/operations/source-semantics.md'], gate: 'Owner-confirmed source access, codebook, identity, money/time and historical availability.', dependencies: 'P00; owner evidence for real-data gates' },
  P02: { paths: ['packages/database/migrations', 'apps/risk-api/src', 'packages/contracts/src'], gate: 'Canonical source mapping, production schema/auth/retention/security acceptance.', dependencies: 'P00; P01 for actual mapping' },
  P03: { paths: ['apps/risk-workers/src', 'apps/risk-workers/scripts/dataset-bulk.mjs', 'docs/architecture/adr/0004-event-backbone.md'], gate: 'Approved connector/backbone adoption, real-source cutover, historical sink and reconciliation.', dependencies: 'P01, P02' },
  P04: { paths: ['packages/risk/src', 'services/ml-inference/lmps_ml/replay.py'], gate: 'Adopted online engine/cache, source availability, concurrency and serving evidence.', dependencies: 'P03; approved draft for pre-transfer simulation' },
  P05: { paths: ['packages/risk/src', 'apps/risk-workers/src/rule-backtest.ts', 'services/ml-inference/lmps_ml/training.py'], gate: 'Actual-source/policy-reviewed features, verified identity for account graphs and capacity.', dependencies: 'P01, P04; bounded offline prototypes permitted separately' },
  P06: { paths: ['apps/risk-portal/src', 'apps/risk-api/src/cases.controller.ts', 'apps/risk-api/src/labels.controller.ts'], gate: 'Approved workflow, authenticated full UI, attachments, real label maturity/sampling and export policy.', dependencies: 'P02, P05 integration' },
  P07: { paths: ['packages/database/src', 'docs/architecture/engineering-foundation-gates.md'], gate: 'User-owned Web App, recipients, browser/device targets and sandbox provider approval.', dependencies: 'P02, P06; mobile/provider decisions' },
  P08: { paths: ['services/ml-inference/lmps_ml/dataset.py', 'services/ml-inference/lmps_ml/evaluation.py', 'services/ml-inference/lmps_ml/serving.py'], gate: 'Eligible real features/labels, temporal evidence, governance and selected registry deployment.', dependencies: 'P05, P06; supervised claims require eligible labels' },
  P09: { paths: ['packages/contracts/src', 'apps/risk-api/src'], gate: 'Actual LMPS pre-transfer contract, payment authority, deadlines and approved degraded policy.', dependencies: 'P04, P05, P08; LMPS owner' },
  P10: { paths: ['ci/verify.py', 'packages/database/scripts/backup.mjs', 'services/ml-inference/lmps_ml/backup.py'], gate: 'Selected platform, security review, actual/target capacity, RPO/RTO and production DR.', dependencies: 'Release-scope P03-P09 integrations' },
  P11: { paths: ['apps/risk-api/scripts/shadow-runtime.mjs', 'docs/operations/real-shadow-foundation.md'], gate: 'Live-data/release authorization, named operations owners and scope-specific sign-offs.', dependencies: 'P10 and release sign-offs' },
};

const RECENT = {
  P04: 'No.42/48 report local temporal datasets and checkpointed feature replay; this is not adopted online serving.',
  P05: 'No.43/50 report actual local baselines and same-cohort comparisons; real detection/identity gates stay open.',
  P06: 'No.49 reports independent append-only synthetic label adjudication/revocation/export; real truth remains unavailable.',
  P08: 'No.42-50 report real local fitting/calibration, MLflow pins/signatures/FastAPI and evaluation; real271-row evaluation remains unavailable.',
  P10: 'No.51 reports owned31-table/three-model restore, local overload metrics and Vite patching; no production capacity/DR claim.',
  P11: 'No.51 persistent shadow is local/synthetic only, not approved-live shadow or production release.',
};

const ORIGINAL_PLAN_DOCUMENTS = Object.freeze([
  '01-tech-stack-and-cost.md', '02-architecture-data-and-api.md', '03-implementation-phases.md',
  '04-code-session-backlog.md', '05-evaluation-security-deployment.md', '06-decisions-and-references.md',
  '07-mariadb-replica-bootstrap.md', '08-postgresql-enterprise-design.md',
  '09-missing-inputs-and-foundation-readiness.md', '10-next-implementation-steps.md', 'README.md',
]);
// Reviewed additive inventory, not a replacement for any original requirement document.
// sourceSnapshot still binds every plan document, including this supplement, on every run.
const PLAN_SUPPLEMENTS = Object.freeze(['portal-mock-inventory-2026-10-27.md']);

export function originalPlanDocuments(root = ROOT) {
  const directory = join(dirname(root), 'plan');
  const names = readdirSync(directory).filter(name => name.endsWith('.md'));
  if (ORIGINAL_PLAN_DOCUMENTS.some(name => !names.includes(name))
    || names.some(name => !ORIGINAL_PLAN_DOCUMENTS.includes(name) && !PLAN_SUPPLEMENTS.includes(name))
    || names.some(name => { const info = lstatSync(join(directory, name)); return !info.isFile() || info.isSymbolicLink() || info.nlink !== 1; })) {
    throw new Error('Plan document inventory changed; review the intake.');
  }
  return [...ORIGINAL_PLAN_DOCUMENTS];
}

export function inventory(root = ROOT) {
  originalPlanDocuments(root);
  const plan = readFileSync(join(dirname(root), 'plan/03-implementation-phases.md'), 'utf8');
  const ledger = readFileSync(join(root, 'docs/implementation-status/plan-progress-2026-10-24.md'), 'utf8');
  const historical = new Map([...ledger.matchAll(/^\| (P\d{2}-\d{2}) \| ([\d.]+) \| (.+) \|$/gm)].map(match => [match[1], { score: match[2], evidence: match[3] }]));
  const rows = [];
  plan.split('\n').forEach((line, index) => {
    const match = line.match(/^- \[([ x])\] (P\d{2}-\d{2}) (.+)$/);
    if (!match) return;
    const phase = match[2].split('-')[0];
    if (!historical.has(match[2]) || !PHASES[phase]) throw new Error('Requirement is missing a historical entry or phase policy.');
    for (const name of PHASES[phase].paths) if (!existsSync(join(root, name))) throw new Error('Requirement evidence path is missing.');
    rows.push({ id: match[2], line: index + 1, checkbox: match[1] === 'x', requirement: match[3], historical: historical.get(match[2]), phase });
  });
  if (rows.length !== 104 || new Set(rows.map(row => row.id)).size !== 104 || historical.size !== 104) throw new Error('Expected all 104 unique MUST items in both the plan and historical ledger.');
  return rows;
}

export function render(root = ROOT) {
  const rows = inventory(root);
  const lines = [
    '# Ralph requirements map — approved intake, 2026-10-25',
    '',
    'Source of truth: the existing sibling [plan](../../../plan/README.md), especially [104 MUST requirements](../../../plan/03-implementation-phases.md). The original plan is read-only to this pilot.',
    '',
    'This is a traceability/review map, not a new implementation score or authorization to execute all requirements. Historical scores/evidence below are explicitly the No.41 assessment from [2026-10-24](../../docs/implementation-status/plan-progress-2026-10-24.md). They are not current after No.42-51. Current reported local evidence is in [implementation status](../../docs/implementation-status/current.md) and the [No.47-51 runbook](../../docs/operations/real-shadow-foundation.md). The previously reported970 tests have not been re-run by the intake pilot.',
    '',
    'Only US-001 in approved-batch.md is executable. None of the104 target requirements is marked complete by this map, pilot or synthetic result. A later approved batch must decompose a selected gap into small tasks, define exact acceptance/checks and keep owner/adoption/release gates separate. Deferred real2GB work and user-owned app work remain deferred.',
    '',
  ];
  lines.push('## Original plan documents', '');
  for (const name of originalPlanDocuments(root)) lines.push(`- [${name}](../../../plan/${name})`);
  lines.push('');
  for (const [phase, policy] of Object.entries(PHASES)) {
    lines.push(`## ${phase}`, '', `Dependencies: ${policy.dependencies}.`, '', `Existing implementation locations to review: ${policy.paths.map(name => `[${name}](../../${name})`).join(', ')}. These links establish location, not verification or target-gate completion.`, '', `Next target gate: ${policy.gate}`, '');
    if (RECENT[phase]) lines.push(`Latest reported local overlay: ${RECENT[phase]} See current status; historical statements below are retained as dated evidence, not present-day absence claims.`, '');
    lines.push('| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |', '| --- | --- | ---: | --- |');
    for (const row of rows.filter(item => item.phase === phase)) {
      lines.push(`| ${row.id} | ${row.line} / ${row.checkbox ? 'checked' : 'unchecked'} | ${row.historical.score} | ${row.historical.evidence.replaceAll('|', '\\|')} |`);
    }
    lines.push('');
  }
  lines.push('## Queue boundaries', '', '- Source/identity/availability/real-label gates require actual owner evidence; unknown stays unknown.', '- No original database migrations, real-source connection, real provider, payment action, commit/push or deployment is authorized by this queue.', '- A later code batch needs its own approved task list. Multiple tasks can be approved together and executed sequentially within that scope.', '- No account rotation or quota-reset polling is implemented; retain the task and use the same selected CODEX_HOME after availability returns.', '');
  return lines.join('\n');
}

export function verifyMap(root = ROOT) {
  const content = readFileSync(join(root, 'tasks/ralph/requirements-map.md'), 'utf8');
  if (content !== render(root)) throw new Error('Requirements map is stale or edited; review it against the original plan.');
  return { mustItems: inventory(root).length, planDocuments: 11 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) process.stdout.write(render());

function resolvePath(value) {
  return value.startsWith('/') ? value : join(process.cwd(), value);
}
