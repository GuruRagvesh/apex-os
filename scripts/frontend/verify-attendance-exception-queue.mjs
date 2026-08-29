#!/usr/bin/env node
/**
 * Apex OS — Attendance Exception Queue verifier (EQ-1).
 *
 * WHY THIS EXISTS
 * ---------------
 * The queue's value comes entirely from what it REFUSES to be. It is a derived
 * read surface: it stores nothing, decides nothing, and points at the services
 * that already own every correction. Each of those refusals is one refactor
 * away from being lost, and none of them would fail loudly if it were — a queue
 * that quietly started writing would look exactly like a queue that worked.
 *
 * Nine rules:
 *
 *  1. NO WRITES IN THE SERVICE. The moment the queue can change attendance,
 *     there are two ways to change attendance and the audited one stops being
 *     the only one.
 *
 *  2. NO WRITE ROUTES. Same rule at the HTTP boundary, where it is easier to
 *     add one by habit.
 *
 *  3. NO SECOND TRUTH STORE. No exception table, no acknowledgement column, no
 *     "resolved" flag. An item exists exactly as long as the authoritative
 *     records say something is wrong, and a stored copy would immediately need
 *     reconciling with the thing it was supposed to describe.
 *
 *  4. THE DERIVATION IS PURE. No imports and no clock, so the same records
 *     always produce the same queue and the rules stay testable without a
 *     database.
 *
 *  5. SCOPE COMES FROM THE SERVER. resolveScope() decides the employee set
 *     before any row is read; a client filter must never reach a where clause.
 *
 *  6. THE BLIND SPOTS ARE ON SCREEN. A camera that never produced a frame
 *     leaves no server record. If the UI does not say so, an empty queue reads
 *     as proof that nothing went wrong.
 *
 *  7. THE VOCABULARIES MATCH. Frontend and backend category unions must be
 *     identical, or a filter silently selects nothing.
 *
 *  8. THE RESOLVE LINKS GO SOMEWHERE. An item whose action links to a route
 *     that does not exist is an exception nobody can act on.
 *
 *  9. AUTHORITY IS VISIBLE. The row must show who may resolve it, so nobody
 *     walks to a screen that will refuse them.
 *
 * Node built-ins only. Reads files, touches nothing else.
 * Exit 0 = all nine hold. Exit 1 = anything else.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FILES = {
  derivation:
    'backend/src/modules/platform/attendance/exceptions/exception-derivation.ts',
  service: 'backend/src/modules/platform/attendance/exceptions/attendance-exception.service.ts',
  controller:
    'backend/src/modules/platform/attendance/exceptions/attendance-exception.controller.ts',
  api: 'frontend/components/attendance/exception-api.ts',
  ui: 'frontend/components/attendance/AttendanceExceptionQueue.tsx',
  schema: 'backend/prisma/schema.prisma',
};

const failures = [];

function read(key) {
  const path = resolve(REPO_ROOT, FILES[key]);
  if (!existsSync(path)) {
    failures.push(`Missing ${FILES[key]}`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

/** Prose explaining a rule must never be mistaken for a breach of it. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const derivation = read('derivation');
const service = read('service');
const controller = read('controller');
const api = read('api');
const ui = read('ui');
const schema = read('schema');

const serviceCode = stripComments(service);
const controllerCode = stripComments(controller);
const derivationCode = stripComments(derivation);

// ── Rule 1: the service writes nothing ──────────────────────────────────────
const MUTATIONS = [
  'create(',
  'createMany(',
  'update(',
  'updateMany(',
  'upsert(',
  'delete(',
  'deleteMany(',
  '$executeRaw',
  '$transaction',
];
for (const call of MUTATIONS) {
  if (serviceCode.includes('.' + call) || serviceCode.includes('prisma.' + call)) {
    failures.push(
      `The exception service calls ${call} — the queue must derive and read, never write.`,
    );
  }
}

// ── Rule 2: no write routes ─────────────────────────────────────────────────
for (const verb of ['Post', 'Patch', 'Put', 'Delete']) {
  if (new RegExp('@' + verb + '\\s*\\(').test(controllerCode)) {
    failures.push(
      `The exception controller exposes an @${verb} route. Resolution belongs to the services ` +
        'that already own each decision.',
    );
  }
}
if (!/@Get\s*\(/.test(controllerCode)) {
  failures.push('The exception controller exposes no @Get route at all.');
}

// ── Rule 3: no second truth store ───────────────────────────────────────────
if (/model\s+AttendanceException\b/.test(schema)) {
  failures.push(
    'schema.prisma declares an AttendanceException model. The queue is derived; a stored copy ' +
      'becomes a second opinion about payroll-relevant facts.',
  );
}
for (const word of ['acknowledged', 'acknowledgedAt', 'exceptionResolvedAt', 'snoozedUntil']) {
  if (new RegExp('\\b' + word + '\\b').test(schema)) {
    failures.push(
      `schema.prisma has a ${word} column. An exception must disappear because the record was ` +
        'corrected, not because somebody dismissed it.',
    );
  }
}

// ── Rule 4: the derivation is pure ──────────────────────────────────────────
if (/^import\s/m.test(derivation)) {
  failures.push(
    'exception-derivation.ts imports something. It must stay dependency-free so the rules are ' +
      'testable without a database and cannot grow a second source of attendance truth.',
  );
}
if (/new Date\(\)|Date\.now\(\)/.test(derivationCode)) {
  failures.push(
    'exception-derivation.ts reads a clock. The same records must always produce the same queue.',
  );
}

// ── Rule 5: scope is resolved server-side ───────────────────────────────────
if (!/resolveScope\(/.test(serviceCode)) {
  failures.push(
    'The exception service does not call resolveScope(); manager scope is not enforced.',
  );
}
if (/where[\s\S]{0,80}userId:\s*filters\./.test(serviceCode)) {
  failures.push(
    'A client-supplied userId reaches a where clause. Filters may narrow the derived list, never ' +
      'widen the queried set.',
  );
}
if (!/ForbiddenException/.test(serviceCode)) {
  failures.push(
    'The exception service never refuses anybody. An employee with no reports must be refused, ' +
      'not shown an empty queue that reads as "nothing is wrong".',
  );
}

// ── Rule 6: the blind spots reach the screen ────────────────────────────────
if (!/UNREPRESENTABLE/.test(derivation)) {
  failures.push('exception-derivation.ts no longer states what it cannot represent.');
}
if (!/notRepresented/.test(serviceCode)) {
  failures.push('The exception API no longer returns notRepresented.');
}
if (!/notRepresented/.test(ui)) {
  failures.push(
    'The exception queue UI does not render notRepresented. An empty queue would then read as ' +
      'proof that nothing failed, including the failures that leave no record.',
  );
}

// ── Rule 7: one vocabulary, two files ───────────────────────────────────────
function categoryUnion(src, label) {
  const start = src.indexOf('ExceptionCategory =');
  if (start === -1) {
    failures.push(`${label} does not declare an ExceptionCategory union.`);
    return null;
  }
  const body = src.slice(start, src.indexOf(';', start));
  return new Set(body.match(/'[A-Z_]+'/g)?.map((s) => s.slice(1, -1)) ?? []);
}
const backendCats = categoryUnion(derivation, 'exception-derivation.ts');
const frontendCats = categoryUnion(api, 'exception-api.ts');
if (backendCats && frontendCats) {
  const missing = [...backendCats].filter((c) => !frontendCats.has(c));
  const extra = [...frontendCats].filter((c) => !backendCats.has(c));
  if (missing.length > 0 || extra.length > 0) {
    failures.push(
      'The exception categories disagree between backend and frontend ' +
        `(only in backend: ${missing.join(', ') || 'none'}; only in frontend: ${extra.join(', ') || 'none'}). ` +
        'A filter for a category the server never emits silently selects nothing.',
    );
  }
  // Every category must have a human label, or a row renders as undefined.
  for (const c of frontendCats) {
    if (!new RegExp(c + ':').test(api.slice(api.indexOf('CATEGORY_LABEL')))) {
      failures.push(`CATEGORY_LABEL has no entry for ${c}.`);
    }
  }
}

// ── Rule 8: the resolve links exist ─────────────────────────────────────────
const hrefFn = api.slice(api.indexOf('export function actionHref'));
for (const raw of hrefFn.match(/'\/[^']*'/g) ?? []) {
  const route = raw.slice(1, -1).split('?')[0];
  const page = resolve(REPO_ROOT, 'frontend/app/(dashboard)' + route, 'page.tsx');
  if (!existsSync(page)) {
    failures.push(
      `actionHref points at ${route}, which has no page. An exception nobody can act on is an alarm.`,
    );
  }
}

// ── Rule 9: authority is visible on the row ─────────────────────────────────
if (!/resolvableBy/.test(ui) || !/RESOLVER_LABEL/.test(ui)) {
  failures.push(
    'The exception row does not show who may resolve it. Without it a manager is invited to open ' +
      'an HR-only decision and be refused.',
  );
}
if (!/resolvingAction\.label/.test(ui)) {
  failures.push('The exception row does not show what action resolves it.');
}

if (failures.length > 0) {
  console.error('[attendance] Exception queue guarantees are not intact:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(
  '[attendance] Exception queue OK — derived, read-only, server-scoped, and honest about its blind spots.',
);
process.exit(0);
