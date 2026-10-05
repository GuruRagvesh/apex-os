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
 * refactor on its own.
 *
 * WHAT THIS FILE USED TO CHECK, AND WHY IT NO LONGER DOES
 * -------------------------------------------------------
 * It enforced the PRE-CANONICAL register: exactly seven columns, a separate
 * Download Excel and Download CSV, getRegister()/downloadRegister(), and
 * formatCompletion()/formatBalance() to stop a null rendering as 0%.
 *
 * That whole stack was retired deliberately. The register now reads the
 * canonical attendance report -- the same dataset the workbook and Finance
 * read -- so there is one computation instead of three, and the server decides
 * every displayed string. Seven columns became the approved nineteen-field
 * monthly summary, and two download buttons became one workbook.
 *
 * The old rules therefore described a product that no longer exists, and a
 * verifier that outlives its contract is worse than no verifier: it fails
 * green builds and invites somebody to "fix" the implementation backwards.
 *
 * The rules below check the CURRENT architecture, and are written to catch the
 * retired stack being reintroduced rather than to merely pass.
 *
 *  1. TWO TABS. Daily Review and Monthly Register. Exceptions and Payroll were
 *     removed from this console deliberately; a later "restore the tab" would
 *     put an operational queue back on a managerial screen.
 *
 *  2. THE COMPONENTS ARE NOT DELETED. Removing a tab is a product decision, not
 *     a demolition. Both stay on disk so the decision is reversible.
 *
 *  3. ONE CANONICAL SOURCE. The register reads getAttendanceReport(month), and
 *     its query is keyed by month so changing month cannot serve stale rows.
 *
 *  4. THE NINETEEN APPROVED SUMMARY FIELDS, exactly and in order. Not eighteen,
 *     not "nineteen plus one that was useful while building it". Every extra
 *     column is something HR has to explain to whoever receives the file.
 *
 *  5. NOTHING SHOWN IS COMPUTED HERE. Rows come from report.summaryRows and
 *     report.dailyRows verbatim. A figure recomputed in JSX is a second
 *     implementation of a formula the server already owns, and the two drift.
 *
 *  6. ONE EXPORT. Download Attendance -> downloadAttendance(month), fetched as
 *     a blob through the authenticated client, with its object URL revoked. A
 *     plain <a href> would 401: auth is a Bearer token from a request
 *     interceptor and a browser navigation carries no such header.
 *
 *  7. THE RETIRED STACK STAYS RETIRED. No getRegister(), no downloadRegister(),
 *     no second CSV path computing its own monthly figures.
 *
 * Node built-ins only. Reads files, touches nothing else.
 * Exit 0 = all hold. Exit 1 = anything else.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FILES = {
  console: 'frontend/components/attendance/AttendanceConsole.tsx',
  canonicalApi: 'frontend/components/attendance/canonical-report-api.ts',
  exceptionQueue: 'frontend/components/attendance/AttendanceExceptionQueue.tsx',
  payrollClose: 'frontend/components/attendance/PayrollMonthClose.tsx',
};

/**
 * The approved monthly summary contract, in order.
 *
 * `&lt;9h` is HTML-escaped in the source, which is how it must stay: a raw `<`
 * there would open a tag. Written escaped so this list can be compared against
 * the JSX exactly, with no normalising step that could hide a changed label.
 */
const SUMMARY_COLUMNS = [
  'Employee', 'ID', 'Department', 'Designation', 'Type',
  'Working', 'Present', 'Absent', 'Half', 'Leave', 'Late', '&lt;9h',
  'Presence h', 'Work h', 'Break h', 'CL', 'LWP', 'Deductions', 'Unresolved',
];

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
const canonicalApi = read('canonicalApi');

// ── Rule 1: two tabs, named for the questions they answer ──────────────────
const tabBlock = consoleTsx.match(/const TAB_LABEL = \{([\s\S]*?)\} as const;/);
if (!tabBlock) {
  failures.push('TAB_LABEL is gone; the console tab set can no longer be verified.');
} else {
  const keys = [...tabBlock[1].matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
  if (keys.length !== 2 || !keys.includes('roster') || !keys.includes('register')) {
    failures.push(
      `The console must have exactly two tabs (roster, register); found: ${keys.join(', ') || 'none'}.`,
    );
  }
  if (/exceptions|payroll/i.test(tabBlock[1])) {
    failures.push('An Exceptions or Payroll tab is back in the Attendance Console.');
  }
  if (!/Daily Review/.test(tabBlock[1]) || !/Monthly Register/.test(tabBlock[1])) {
    failures.push('The tabs are not labelled "Daily Review" and "Monthly Register".');
  }
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

// ── Rule 3: one canonical source, keyed by month ────────────────────────────
if (!/getAttendanceReport\(month\)/.test(consoleTsx)) {
  failures.push(
    'The register does not call getAttendanceReport(month). It must read the canonical ' +
      'attendance report -- the same dataset the workbook and Finance read.',
  );
}
if (!/queryKey:\s*\['attendance-report',\s*month\]/.test(consoleTsx)) {
  failures.push(
    "The register query is not keyed ['attendance-report', month]; changing month would " +
      'serve stale rows.',
  );
}

// ── Rules 4-6: the register block itself ───────────────────────────────────
const registerBlock = consoleTsx.match(/tab === 'register' && \(([\s\S]*?)\n {6}\)\}/);
if (!registerBlock) {
  failures.push('The Monthly Register block could not be located; its columns cannot be verified.');
} else {
  const body = registerBlock[1];

  // The block holds two tables: the monthly summary, then daily attendance.
  // Only the first has a fixed approved column set -- the daily table shows a
  // useful subset on screen, and the WORKBOOK owns the full 26-column daily
  // contract (asserted by backend tests, not here).
  const tables = body.split(/<table\b/).slice(1);
  if (tables.length < 2) {
    failures.push(
      `The register must render a monthly summary table and a daily attendance table; ` +
        `found ${tables.length}.`,
    );
  }

  const summaryHeaders = tables.length
    ? [...tables[0].matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1].trim())
    : [];

  if (summaryHeaders.join('|') !== SUMMARY_COLUMNS.join('|')) {
    const missing = SUMMARY_COLUMNS.filter((c) => !summaryHeaders.includes(c));
    const extra = summaryHeaders.filter((c) => !SUMMARY_COLUMNS.includes(c));
    failures.push(
      `The monthly summary must show exactly the ${SUMMARY_COLUMNS.length} approved fields in ` +
        `order; found ${summaryHeaders.length}: ${summaryHeaders.join(' | ')}` +
        (missing.length ? `\n    missing: ${missing.join(', ')}` : '') +
        (extra.length ? `\n    not approved: ${extra.join(', ')}` : ''),
    );
  }

  // ── Rule 5: values are read, never recomputed ──────────────────────────
  if (!/report\.summaryRows\.map\(/.test(body)) {
    failures.push('The monthly summary does not render report.summaryRows; its source is unverifiable.');
  }
  if (!/report\.dailyRows/.test(body)) {
    failures.push('The daily table does not render report.dailyRows; its source is unverifiable.');
  }
  // Arithmetic on canonical summary figures inside the table would be a second
  // implementation of a formula the server already owns.
  if (/\{[^}]*\bs\.(workingDays|presentDays|absentDays|halfDays|leaveDays|lateDays)[^}]*[*/+-][^}]*\}/.test(body)) {
    failures.push(
      'The summary table does arithmetic on the canonical figures. The screen and the ' +
        'workbook must render one result, not two implementations of the formula.',
    );
  }
  // Working Days is the business calendar's answer, delivered by the server.
  if (!/summaryRows(\?\.)?\[0\](\?\.)?\.workingDays|s\.workingDays/.test(body)) {
    failures.push('Working Days is not read from the canonical server result.');
  }
  if (/workingDays[^}]*(elapsed|\.length|filter\()/.test(body)) {
    failures.push('Working Days is being derived in the UI; it is the business calendar’s answer.');
  }

  // ── Rule 6: exactly one export ─────────────────────────────────────────
  const downloadLabels = [...body.matchAll(/Download (Attendance|Excel|CSV)/g)].map((m) => m[1]);
  if (!downloadLabels.includes('Attendance')) {
    failures.push('The register is missing its "Download Attendance" action.');
  }
  for (const retired of ['Excel', 'CSV']) {
    if (downloadLabels.includes(retired)) {
      failures.push(
        `A "Download ${retired}" button is back. The canonical workbook is one XLSX with two ` +
          'sheets; a second export means a second computation of the same month.',
      );
    }
  }
  // Asserted against the whole component, not this block: the button calls a
  // handler and the handler calls downloadAttendance(month), which is the
  // right shape. Requiring the call inside the JSX would push it inline.
  if (!/downloadAttendance\(month\)/.test(consoleTsx)) {
    failures.push('Nothing calls downloadAttendance(month); the export is not wired.');
  }
  if (/<a[^>]+href=[^>]*attendance\/report/.test(consoleTsx)) {
    failures.push(
      'The workbook is downloaded through a plain link. Auth is a Bearer token added by a ' +
        'request interceptor, and a browser navigation carries no such header — it would 401.',
    );
  }
}

// ── Rule 7: the retired stack stays retired ────────────────────────────────
//
// Matched outside comments: the console explains in prose that getRegister()
// was replaced, and that sentence must not trip the check that it is gone.
const code = consoleTsx
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
for (const retired of ['getRegister', 'downloadRegister']) {
  if (new RegExp(`\\b${retired}\\s*\\(`).test(code)) {
    failures.push(
      `${retired}() is back. It ran a second, independent monthly calculation beside the ` +
        'canonical report; the two could disagree about the same month.',
    );
  }
}

// ── The transport ──────────────────────────────────────────────────────────
if (!/responseType: 'blob'/.test(canonicalApi)) {
  failures.push('downloadAttendance does not request a blob; the workbook would arrive corrupted.');
}
if (!/revokeObjectURL/.test(canonicalApi)) {
  failures.push('The workbook download never revokes its object URL; the file stays in memory.');
}

if (failures.length > 0) {
  console.error('[attendance] The Monthly Register surface is not intact:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(
  `[attendance] Register OK — two tabs, ${SUMMARY_COLUMNS.length} approved summary fields, ` +
    'one canonical source, one workbook export.',
);
process.exit(0);
