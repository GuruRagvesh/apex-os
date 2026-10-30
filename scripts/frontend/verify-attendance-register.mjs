#!/usr/bin/env node
/**
 * Apex OS — Attendance Console register verifier.
 *
 * WHY THIS EXISTS
 * ---------------
 * The frontend has no test runner, so the guarantees below are checked
 * statically, the same way the day surface and Workday surface rules are.
 *
 * The Monthly Register is a document HR forwards outside the company. What it
 * shows and what it leaves out are both decisions, and neither survives a
 * refactor on its own. Seven rules:
 *
 *  1. TWO TABS. Daily Review and Monthly Register. Exceptions and Payroll were
 *     removed from this console deliberately; a later "restore the tab" would
 *     put an operational queue back on a managerial screen.
 *
 *  2. THE BACKENDS ARE NOT DELETED. Removing a tab is a product decision, not
 *     a demolition. Both components stay on disk so the decision is reversible.
 *
 *  3. EXACTLY THE AGREED COLUMNS. Employee, Present, Absent, Half days, Leave
 *     days, Late days, Below 9 hours, Leave balance, Comp off, Unresolved,
 *     Attendance % and Provisional -- the Monthly Summary figures HR asked to
 *     see on screen. Every extra column is something HR has to explain.
 *
 *  4. NOTHING SHOWN IS COMPUTED HERE. The table, the workbook and the CSV read
 *     the same server report (one canonical assembler). A percentage recomputed in JSX is a second
 *     implementation of the formula, and the two drift.
 *
 *  5. NULL IS A DASH. An employee with no eligible working day has not scored
 *     zero; nothing has been measured about them. Printing 0% beside a name is
 *     an accusation the data does not support.
 *
 *  6. BOTH DOWNLOADS EXIST AND ARE AUTHENTICATED. Auth is a Bearer token from a
 *     request interceptor, so a plain <a href> would 401.
 *
 *  7. THE MONTH IS THE MONTH. The register asks for a whole month and the
 *     server clamps its own arithmetic to elapsed days -- the frontend must not
 *     "helpfully" trim the range and change what Working Days means.
 *
 * Node built-ins only. Reads files, touches nothing else.
 * Exit 0 = all seven hold. Exit 1 = anything else.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FILES = {
  console: 'frontend/components/attendance/AttendanceConsole.tsx',
  workspace: 'frontend/components/attendance/AttendanceConsoleWorkspace.tsx',
  api: 'frontend/components/attendance/console-api.ts',
  month: 'frontend/components/attendance/register-month.ts',
  exceptionQueue: 'frontend/components/attendance/AttendanceExceptionQueue.tsx',
  payrollClose: 'frontend/components/attendance/PayrollMonthClose.tsx',
};

const failures = [];

function read(key) {
  const path = resolve(REPO_ROOT, FILES[key]);
  if (!existsSync(path)) {
    failures.push(`${FILES[key]} is missing`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

const consoleTsx = read('console');
const workspaceTsx = read('workspace');
const api = read('api');
const month = read('month');

// ── Rule 1: two tabs, named for the questions they answer ──────────────────
// The console workspace has two tabs, Team Review Corrections and Team
// Attendance. Team Attendance renders the Monthly Register only, as its default.
const workspaceTabs = [...workspaceTsx.matchAll(/role="tab"[\s\S]*?aria-selected=\{tab === '(\w+)'\}/g)].map((m) => m[1]);
if (workspaceTabs.length !== 2 || !workspaceTabs.includes('reviews') || !workspaceTabs.includes('attendance')) {
  failures.push(`The console workspace must have exactly two tabs (reviews, attendance); found: ${workspaceTabs.join(', ') || 'none'}.`);
}
if (!/Team Review Corrections/.test(workspaceTsx) || !/Team Attendance/.test(workspaceTsx)) {
  failures.push('The tabs are not labelled "Team Review Corrections" and "Team Attendance".');
}
if (/exceptions|payroll/i.test(workspaceTsx.replace(/aria-label="[^"]*"/g, ''))) {
  failures.push('An Exceptions or Payroll tab is back in the Attendance Console.');
}
if (!/Monthly Register/.test(consoleTsx)) {
  failures.push('The Team Attendance view no longer shows the Monthly Register.');
}
if (/<AttendanceExceptionQueue\b|<PayrollMonthClose\b/.test(consoleTsx)) {
  failures.push('The Attendance Console still renders the exception queue or the payroll close.');
}

// ── Rule 2: removed from the console, not deleted from the repo ────────────
for (const key of ['exceptionQueue', 'payrollClose']) {
  if (!existsSync(resolve(REPO_ROOT, FILES[key]))) {
    failures.push(
      `${FILES[key]} was deleted. Removing a tab is a product decision; deleting the ` +
        'component makes it irreversible and was not what was asked for.',
    );
  }
}

// ── Rule 3: exactly the agreed columns ─────────────────────────────────────
const REGISTER_HEADERS = [
  'Employee', 'Present', 'Absent', 'Half days', 'Leave days', 'Late days', 'Below 9 hours',
  'Leave balance', 'Comp off (hrs)', 'Unresolved', 'Attendance %', 'Provisional',
];
// The register is the console's only view now: everything from its header row on.
const registerBlock = consoleTsx.match(/(<span[^>]*>\s*Monthly Register\s*<\/span>[\s\S]*<\/table>)/);
if (!registerBlock) {
  failures.push('The Monthly Register block could not be located; its columns cannot be verified.');
} else {
  const body = registerBlock[1];
  const headers = [...body.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1].trim());
  if (headers.join('|') !== REGISTER_HEADERS.join('|')) {
    failures.push(`The register columns must be ${REGISTER_HEADERS.join(' | ')}; found ${headers.join(' | ')}`);
  }
  const forbidden = /\b(LWP|Worked|Punch In|Punch Out|Salary|Payroll|Sessions|Workday|Geofence|Exception)\b/i;
  const offending = headers.filter((h) => forbidden.test(h));
  if (offending.length > 0) {
    failures.push(`The register shows columns it must not: ${offending.join(', ')}`);
  }

  // ── Rule 4: values are read, never recomputed ──────────────────────────
  //
  // Any arithmetic on the seven fields inside the table is a second
  // implementation of a formula the server already owns.
  if (/\{[^}]*e\.(daysPresent|halfDays|daysAbsent|latePunchIns|leaveDays|daysBelowNineHours|approvedCompOff|unresolvedDays)[^}]*[*/+][^}]*\}/.test(body)) {
    failures.push(
      'The register table does arithmetic on the server figures. The UI, the workbook and ' +
        'the CSV must all render one result, not three implementations of the formula.',
    );
  }
  if (/attendanceCompletionPercentage[^}]*\?[^}]*:/.test(body)) {
    failures.push(
      'The completion percentage is formatted inline. Use formatCompletion() so the screen, ' +
        'the workbook and the CSV cannot disagree about what null looks like.',
    );
  }

  // ── Rule 5: null is a dash, never zero ────────────────────────────────
  if (!/formatCompletion\(/.test(body) || !/formatBalance\(/.test(body)) {
    failures.push('The register does not use formatCompletion()/formatBalance(); a null would render as 0.');
  }

  // ── Rule 6: both downloads, through the authenticated client ──────────
  if (!/Download Excel/.test(body) || !/Download CSV/.test(body)) {
    failures.push('The register is missing a Download Excel or Download CSV button.');
  }
  if (!/download\('xlsx'\)/.test(body) || !/download\('zip'\)/.test(body)) {
    failures.push('A download button is not wired to the register download.');
  }
  // The visible downloads are the report package (export.xlsx / export.zip).
  // The legacy seven-column export.csv stays on the server for API callers
  // only; routing the UI through it would hand HR a different document.
  if (!/register\/export\.\$\{format\}/.test(api) || !/format: 'xlsx' \| 'zip'/.test(api)) {
    failures.push('downloadRegister does not request export.xlsx / export.zip.');
  }
  for (const [name, text] of [['AttendanceConsole.tsx', consoleTsx], ['console-api.ts', api]]) {
    if (/export\.csv/.test(text)) {
      failures.push(`${name} references the legacy export.csv; the visible download must use export.zip.`);
    }
  }
  if (/<a[^>]+href=[^>]*register\/export/.test(consoleTsx)) {
    failures.push(
      'The register is downloaded through a plain link. Auth is a Bearer token added by a ' +
        'request interceptor, and a browser navigation carries no such header — it would 401.',
    );
  }

  // The working-day metric must be the server's month total, not a local count.
  if (!/register\?\.workingDays|register\.workingDays/.test(body)) {
    failures.push('Working Days is not read from the server result.');
  }
  if (/workingDays[^}]*(elapsed|\.length|filter\()/.test(body)) {
    failures.push('Working Days is being derived in the UI; it is the business calendar’s answer.');
  }
}

// ── Rule 7: the request covers the whole month ─────────────────────────────
if (!/monthRange\(/.test(consoleTsx)) {
  failures.push('The register range is not built with monthRange(); the month it reports is unverifiable.');
}
if (!/queryKey: \['console-register', month\]/.test(consoleTsx)) {
  failures.push('The register query is not keyed by month; changing month would serve stale rows.');
}

// ── The transport, and the duplicated formatters ───────────────────────────
if (!/responseType: 'blob'/.test(api)) {
  failures.push('downloadRegister does not request a blob; the file would arrive corrupted.');
}
if (!/revokeObjectURL/.test(api)) {
  failures.push('The register download never revokes its object URL; the file stays in memory.');
}
for (const fn of ['formatCompletion', 'formatBalance', 'formatHours', 'formatProvisional', 'registerFileName', 'reportFileName', 'monthRange', 'shiftMonth']) {
  if (!new RegExp(`export function ${fn}\\b`).test(month)) {
    failures.push(`register-month.ts no longer exports ${fn}(); its backend parity test cannot run.`);
  }
}

if (failures.length > 0) {
  console.error('[attendance] The Monthly Register surface is not intact:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('[attendance] Register OK — Monthly Register is the Team Attendance view, served by the canonical report, both exports.');
process.exit(0);
