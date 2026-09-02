#!/usr/bin/env node
/**
 * Apex OS — Attendance Data Control surface verifier.
 *
 * WHY THIS EXISTS
 * ---------------
 * The frontend has no test runner. The wording and the decision logic live in
 * import-presentation.ts and are exercised from the backend suite; what CANNOT
 * be reached that way is the shape of the React shells — and several of the
 * guarantees this subsystem rests on are properties of those shells rather than
 * of any function.
 *
 * Nine rules:
 *
 *  1. THE CONSOLE STAYS AT TWO TABS. Daily Review and Monthly Register. Import
 *     is an ACTION leading to its own workspace, never a third tab: it is
 *     occasional, deliberate work with a multi-step flow, and the console was
 *     deliberately reduced to the two questions HR asks daily.
 *
 *  2. EXCEPTIONS AND PAYROLL DO NOT COME BACK. Adding a workspace is not a
 *     licence to restore the tabs that were removed on purpose.
 *
 *  3. APPROVE AND APPLY ARE TWO CONTROLS. Collapsing them would remove the only
 *     moment at which somebody sees the comparison, and the only moment at
 *     which Apex OS can notice the world moved between review and write.
 *
 *  4. THE SCREEN NEVER CLASSIFIES. No local recomputation of NEW / MATCH /
 *     CHANGE / CONFLICT, and no local approvability rule. A second
 *     implementation of the decision that writes attendance eventually
 *     disagrees with the first.
 *
 *  5. RE-PREVIEW GOES TO THE SERVER. The way out of "needs re-review" is the
 *     re-preview endpoint, never a local reset of row state — a local reset
 *     puts a new signature on an old comparison.
 *
 *  6. NO PRIVATE EVIDENCE ON SCREEN. Fingerprints, evidence ids, object keys,
 *     photo hashes, IP and device metadata are backend audit details.
 *
 *  7. NO INVENTED TIMES. No 09:30 / 18:30 literals anywhere in the import
 *     surface. A historical PRESENT day genuinely has no punches.
 *
 *  8. DOWNLOADS GO THROUGH THE AUTHENTICATED CLIENT. A plain <a href> would
 *     401: the bearer token is attached by a request interceptor.
 *
 *  9. THE IMPORTER CANNOT TOUCH LEAVE. No control here creates, approves or
 *     adjusts leave; a missing leave authority is a conflict to resolve in the
 *     leave workflow.
 *
 * Node built-ins only. Reads files, touches nothing else.
 * Exit 0 = all nine hold. Exit 1 = anything else.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];
const checked = [];

const read = (rel) => {
  const path = resolve(root, rel);
  if (!existsSync(path)) {
    failures.push(`MISSING FILE: ${rel}`);
    return '';
  }
  return readFileSync(path, 'utf8');
};

const check = (label, condition, detail) => {
  checked.push(label);
  if (!condition) failures.push(`${label}\n    ${detail}`);
};

const CONSOLE = read('frontend/components/attendance/AttendanceConsole.tsx');
const WORKSPACE = read('frontend/components/attendance/ImportWorkspace.tsx');
const TABLE = read('frontend/components/attendance/ImportRowTable.tsx');
const API = read('frontend/components/attendance/import-api.ts');
const PRESENT = read('frontend/components/attendance/import-presentation.ts');
const PAGE = read('frontend/app/(dashboard)/attendance/import/page.tsx');
const SURFACE = [WORKSPACE, TABLE, API, PRESENT, PAGE].join('\n');

// ── 1. Two tabs, and import is an action ────────────────────────────────────
const tabKeys = CONSOLE.match(/const TAB_LABEL = \{([\s\S]*?)\} as const;/);
check(
  '1a. The console still declares exactly two tabs',
  tabKeys && (tabKeys[1].match(/^\s*\w+:/gm) ?? []).length === 2,
  'TAB_LABEL must contain exactly roster and register.',
);
check(
  '1b. Import is reached from the console',
  CONSOLE.includes('/attendance/import'),
  'The console must link to the import workspace.',
);
check(
  '1c. Import is a link, not a tab button',
  /<Link[\s\S]{0,200}\/attendance\/import/.test(CONSOLE) &&
    // The TAB_LABEL OBJECT is what must not gain an import entry. Matching the
    // identifier anywhere would also hit its render site, which now sits beside
    // the import link -- a false positive that would make this rule noise.
    !(tabKeys && /import/i.test(tabKeys[1])),
  'Import must be an action leading to its own route, not a third entry in TAB_LABEL.',
);
check(
  '1d. The import route exists and is a thin adapter',
  PAGE.includes('ImportWorkspace') && PAGE.length < 800,
  'app/(dashboard)/attendance/import/page.tsx should render the workspace and nothing else.',
);

// ── 2. Exceptions and Payroll stay out ──────────────────────────────────────
check(
  '2. Exceptions and Payroll are not restored to the console',
  !/AttendanceExceptionQueue|PayrollMonthClose/.test(CONSOLE),
  'Those tabs were removed deliberately; the workspace is not a route back in.',
);

// ── 3. Approve and apply stay separate ──────────────────────────────────────
check(
  '3a. Both approve and apply exist as distinct calls',
  API.includes('approveBatch') && API.includes('applyBatch') &&
    /\/approve/.test(API) && /\/apply/.test(API),
  'The client must call the two endpoints separately.',
);
check(
  '3b. The workspace confirms each one on its own',
  WORKSPACE.includes("'APPROVE'") && WORKSPACE.includes("'APPLY'") &&
    WORKSPACE.includes('onApprove') && WORKSPACE.includes('onApply'),
  'Approve and apply must be two confirmations, not one ambiguous button.',
);
// Scoped to the confirmation panel itself. Searching the whole file would be
// satisfied by the same sentence on the button's help text, so removing it from
// the panel -- the one place a person reads immediately before signing -- would
// go unnoticed.
const approveStart = WORKSPACE.indexOf("confirming === 'APPROVE'");
const approvePanel =
  approveStart === -1 ? '' : WORKSPACE.slice(approveStart, approveStart + 2200);
check(
  '3c. The approval confirmation itself says attendance does not change yet',
  /does not change attendance yet/i.test(approvePanel),
  'The panel shown immediately before signing must state that nothing is written yet.',
);
check(
  '3d. Apply does not promise every row will apply',
  /cannot overwrite attendance that has changed/i.test(WORKSPACE) &&
    !/all rows will be|every row will be/i.test(WORKSPACE),
  'Staleness protection legitimately refuses rows; the confirmation must not overpromise.',
);

// ── 4. No local classification or approvability ─────────────────────────────
check(
  '4a. No row classification is computed on this side',
  !/classification\s*=\s*['"](NEW|MATCH|CHANGE|CONFLICT|INVALID)['"]/.test(SURFACE),
  'Classification is the server\'s verdict; the screen only renders it.',
);
check(
  '4b. Counts come from the batch, not from counting rows',
  !/rows\.filter\([^)]*\)\.length\s*[,;)]/.test(WORKSPACE) ||
    !/totalRows\s*[:=]\s*rows\./.test(WORKSPACE),
  'Summary counts must be the server\'s stored counts.',
);

// ── 5. Re-preview is a server call ──────────────────────────────────────────
check(
  '5a. Re-preview calls the endpoint',
  API.includes('rePreviewBatch') && /re-preview/.test(API),
  'There must be a real re-preview call.',
);
check(
  '5b. Nothing resets row state locally',
  !/applyState\s*[:=]\s*['"]PENDING['"]/.test(SURFACE) &&
    !/classification\s*[:=]\s*['"]PENDING['"]/.test(SURFACE),
  'Resetting rows on this side would put a new signature on an old comparison.',
);

// ── 6. No private evidence rendered ─────────────────────────────────────────
for (const field of [
  'currentFingerprint',
  'currentPunchInEvidenceId',
  'currentPunchOutEvidenceId',
  'photoObjectKey',
  'photoHash',
  'ipAddress',
  'deviceMetadata',
  'sourceFingerprint',
]) {
  // Mentioning one in a comment explaining its absence is fine; using it is not.
  const used = new RegExp(`(?<!\\/\\/[^\\n]{0,200})\\b${field}\\b\\s*[.,}\\]]`).test(
    SURFACE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
  );
  check(`6. ${field} is never rendered`, !used, `${field} is a backend audit detail.`);
}

// ── 7. No invented times ────────────────────────────────────────────────────
check(
  '7. No fabricated punch times anywhere in the import surface',
  !/['"](09:30|18:30|09:00|18:00)['"]/.test(
    SURFACE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
  ),
  'A historical PRESENT day has no punches; a default here would fabricate evidence.',
);
check(
  '7b. Absent values render as a dash',
  PRESENT.includes("export const EMPTY = '—'") && TABLE.includes('EMPTY'),
  'Null is not zero and not a guessed time.',
);

// ── 8. Authenticated downloads ──────────────────────────────────────────────
check(
  '8a. Template and error workbook go through the api client',
  // Both route through ONE authenticated helper rather than repeating the
  // call, so the property to check is that the helper is authenticated and
  // that both downloads use it -- not that a literal url sits next to api.get.
  /async function download\([\s\S]{0,400}api\.get\([\s\S]{0,120}responseType: 'blob'/.test(API) &&
    /downloadTemplate[\s\S]{0,200}await download\(/.test(API) &&
    /downloadErrorWorkbook[\s\S]{0,200}await download\(/.test(API),
  'A plain <a href> would 401 — the token is attached by a request interceptor.',
);
check(
  '8b. No raw anchor to an API download',
  !/href=\{?["'`][^"'`]*attendance\/import[^"'`]*\.xlsx/.test(SURFACE),
  'Downloads must not be plain links.',
);
check(
  '8c. The error workbook is the server\'s, not rebuilt here',
  !/exceljs|new Workbook|XLSX\./.test(SURFACE),
  'The error file already exists on the server.',
);

// ── 9. The importer cannot touch leave ──────────────────────────────────────
check(
  '9. No leave is created or approved from the import surface',
  !/leaveRequest|createLeave|approveLeave|leaveBalance/i.test(SURFACE),
  'A missing leave authority is resolved in the leave workflow, never here.',
);

// ── Report ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error('\n[attendance-import] FAILED\n');
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  console.error(`  ${failures.length} of ${checked.length} checks failed.\n`);
  process.exit(1);
}
console.log(`[attendance-import] OK — ${checked.length} checks passed.`);
