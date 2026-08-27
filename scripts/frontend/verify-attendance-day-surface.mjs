#!/usr/bin/env node
/**
 * Apex OS — My Attendance day surface verifier.
 *
 * WHY THIS EXISTS
 * ---------------
 * The frontend has no test runner, so the guarantees below are checked
 * statically, the same way the single-Workday-surface rule is.
 *
 * Six rules, each protecting something that has actually gone wrong or would
 * be silent if it did:
 *
 *  1. ONE DAY SURFACE. Selecting a date opens the drawer. The old inline
 *     detail panel must be gone, not kept alongside — two places rendering the
 *     same day is how they drift apart, and the one below the fold is the one
 *     nobody scrolls to.
 *
 *  2. THE THREE DURATIONS STAY SEPARATE. Attendance presence, Workday span and
 *     Worked time answer different questions and only the first is policy.
 *     Collapsing them once already turned a UI tidy-up into a policy change,
 *     so the day detail must render all three and must not compute presence
 *     itself — assessPresence() owns that arithmetic.
 *
 *  3. PHOTOS ARE KEYED TO EVIDENCE. A photo uploaded for a punch that was then
 *     refused leaves an orphan row with no evidence behind it. Production has
 *     two such orphans right now. PunchPhoto must be addressed by evidence id,
 *     never by a photo id, so an orphan cannot be presented as official
 *     attendance evidence.
 *
 *  4. ONE LEAVE BALANCE COMPONENT. My Attendance and the profile must render
 *     the same card, or the two pages can show different numbers for the same
 *     person.
 *
 *  5. TERMINOLOGY. A company holiday is a date nobody works; a leave balance is
 *     personal entitlement. "Holidays available" conflates them.
 *
 *  6. NO CROSS-BOUNDARY IMPORT. platforms/** may not import frontend/**. The
 *     profile attendance section is composed at the route for this reason, and
 *     a later "tidy-up" moving it into ProfileScreen would break the boundary
 *     validator.
 *
 * Node built-ins only. Reads files, touches nothing else.
 * Exit 0 = all six hold. Exit 1 = anything else.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FILES = {
  calendar: 'frontend/components/attendance/AttendanceCalendar.tsx',
  detail: 'frontend/components/attendance/AttendanceDayDetail.tsx',
  drawer: 'frontend/components/attendance/AttendanceDrawer.tsx',
  card: 'frontend/components/attendance/LeaveBalanceCard.tsx',
  summary: 'frontend/components/attendance/AttendanceLeaveSummary.tsx',
  profileRoute: 'frontend/app/(dashboard)/profile/page.tsx',
  profileScreen: 'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
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

const calendar = read('calendar');
const detail = read('detail');
const card = read('card');
const summary = read('summary');
const profileRoute = read('profileRoute');
const profileScreen = read('profileScreen');

// ── Rule 1: one day surface ────────────────────────────────────────────────
if (!/<AttendanceDrawer\b/.test(calendar)) {
  failures.push('AttendanceCalendar does not render <AttendanceDrawer>; selecting a day opens nothing.');
}
if (!/<AttendanceDayDetail\b/.test(calendar)) {
  failures.push('AttendanceCalendar does not render <AttendanceDayDetail> inside the drawer.');
}
if (!/setSelected\(/.test(calendar)) {
  failures.push('AttendanceCalendar no longer tracks a selected date.');
}
// The old panel rendered its own <dl> of facts directly in the calendar.
if (/function Fact\(/.test(calendar)) {
  failures.push(
    'AttendanceCalendar still defines the inline Fact helper — the old day panel was not removed.',
  );
}
if (/RequestCorrectionForm/.test(calendar)) {
  failures.push(
    'AttendanceCalendar still renders RequestCorrectionForm; the correction flow belongs in the drawer.',
  );
}

// ── Rule 2: three durations, kept apart ────────────────────────────────────
// Each must be an actual rendered LABEL. Matching the prose that explains the
// distinction is not enough: renaming the field while leaving the paragraph
// intact would keep a loose check green while the UI merged two durations.
for (const [label, pattern] of [
  ['Attendance presence', /label="Attendance presence"/],
  ['Workday span', /label="Workday span"/],
  ['Worked', /label="Worked"/],
  ['Required', /label="Required"/],
]) {
  if (!pattern.test(detail)) {
    failures.push(`AttendanceDayDetail does not show "${label}" — the durations must stay distinct.`);
  }
}
if (!/assessPresence\(/.test(detail)) {
  failures.push('AttendanceDayDetail does not call assessPresence(); it must not compute presence itself.');
}
// A literal 540 here would mean the requirement was re-stated rather than read.
if (/\b540\b/.test(detail)) {
  failures.push(
    'AttendanceDayDetail hardcodes 540. The requirement comes from assessPresence(), not from the view.',
  );
}

// ── Rule 3: photos keyed to evidence ───────────────────────────────────────
if (/<PunchPhoto\b/.test(detail)) {
  if (!/evidenceId=\{e\.id\}/.test(detail)) {
    failures.push(
      'PunchPhoto is not addressed by evidence id. An orphan photo from a refused punch could render as evidence.',
    );
  }
  if (/evidenceId=\{[^}]*photo(Asset)?Id/i.test(detail)) {
    failures.push('PunchPhoto is addressed by a photo id; it must be the evidence id.');
  }
}

// ── Rule 4: one leave balance component ────────────────────────────────────
if (!/<LeaveBalanceCard\b/.test(detail)) {
  failures.push('AttendanceDayDetail does not render <LeaveBalanceCard>.');
}
if (!/<LeaveBalanceCard\b/.test(summary)) {
  failures.push('AttendanceLeaveSummary does not reuse <LeaveBalanceCard>; it must not restate balances.');
}
if (!/<AttendanceLeaveSummary\b/.test(profileRoute)) {
  failures.push('The profile route does not render <AttendanceLeaveSummary>.');
}

// ── Rule 5: terminology ────────────────────────────────────────────────────
// Comments are stripped first: a file explaining WHY the phrase is wrong must
// not be flagged for containing it.
const withoutComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

for (const [name, src] of [
  ['LeaveBalanceCard', card],
  ['AttendanceDayDetail', detail],
  ['AttendanceLeaveSummary', summary],
]) {
  if (/holidays?\s+available/i.test(withoutComments(src))) {
    failures.push(`${name} calls leave entitlement "holidays available"; they are different things.`);
  }
}

// ── Rule 6: no platforms -> frontend import ────────────────────────────────
if (/from\s+['"]@\/components\/attendance/.test(profileScreen)) {
  failures.push(
    'ProfileScreen imports a frontend attendance component. platforms/** may not import frontend/** — ' +
      'compose it at the route instead.',
  );
}

if (failures.length > 0) {
  console.error('[attendance] My Attendance day surface is not intact:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('[attendance] Day surface OK — one drawer, three distinct durations, evidence-keyed photos.');
process.exit(0);
