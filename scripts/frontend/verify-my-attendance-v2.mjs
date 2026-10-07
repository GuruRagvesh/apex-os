#!/usr/bin/env node
/**
 * Apex OS — My Attendance V2 surface verifier.
 *
 * WHY THIS EXISTS
 * ---------------
 * The frontend has no test runner, so the guarantees below are checked
 * statically, the same way the existing attendance-day and single-workday
 * surface rules are. No test framework is introduced for one page.
 *
 * Ten rules, each protecting something that has already gone wrong once in
 * this codebase or would be silent if it did:
 *
 *  1. THE ROUTE STAYS HIDDEN. V2 must not appear in any navigation list while
 *     it is being validated. A link added "just for testing" is how an
 *     unfinished payroll-facing page reaches 56 employees.
 *
 *  2. THE LIVE PAGE IS UNTOUCHED. /attendance must still mount the existing
 *     AttendanceToday and AttendanceCalendar. The whole point of a hidden
 *     route is that the production surface keeps working.
 *
 *  3. NO FIGURE IS DEFAULTED TO ZERO. The V2 tree must contain no `?? 0` or
 *     `|| 0` on a displayed figure. Rendering 0h 00m because a request failed
 *     tells an employee they worked nothing, which is both false and an
 *     accusation the system cannot support.
 *
 *  4. NO FRONTEND REQUIREMENT CONSTANT. The live page hardcodes
 *     REQUIRED_PRESENCE_MINUTES = 540, which is a fifth copy of a
 *     payroll-facing number. V2 must not add a sixth: the requirement comes
 *     from the server or is shown as unavailable.
 *
 *  5. NO FRONTEND PRESENCE ARITHMETIC. V2 must not import assessPresence and
 *     must not compute presence from punch times. A duration computed in React
 *     is a policy decision made in React.
 *
 *  6. PHOTOS ONLY IN THE DRAWER. PunchPhoto may be imported by the drawer and
 *     nowhere else. A punch photo is evidence viewed deliberately, never a
 *     thumbnail in a calendar cell or a list row.
 *
 *  7. PHOTOS ARE NOT PREFETCHED. The photo must sit behind an explicit action,
 *     because a signed URL is a grant and ten of them per drawer open is not
 *     the same as one per request to look.
 *
 *  8. COLOUR IS NEVER ALONE. Every status presentation carries a label and a
 *     glyph as well as a colour. A red cell and a purple cell are
 *     indistinguishable to a large minority of readers.
 *
 *  9. THE BANNER IS THE SERVER'S. StatusBanner must not contain status copy.
 *     A message assembled in React means the first state nobody thought about
 *     gets somebody else's sentence.
 *
 * 10. PRESENCE AND EFFECTIVE WORK ARE NEVER MIXED. The exposed requirement is a
 *     presence SPAN; worked minutes are effective work with breaks removed.
 *     Subtracting one from the other would tell an employee who completed their
 *     day that they still owed their lunch break — the approved screenshot
 *     computes it that way, and the ruling was to keep the layout and fix the
 *     labels instead. So the fields must be the presence-named ones, the labels
 *     must say which measure they carry, and no expression may combine the
 *     requirement with worked minutes.
 *
 * Node built-ins only. Reads files, touches nothing else.
 * Exit 0 = all ten hold. Exit 1 = anything else.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const v2Dir = join(root, 'frontend', 'components', 'attendance-v2');
const v2Route = join(root, 'frontend', 'app', '(dashboard)', 'attendance-v2', 'page.tsx');
const liveRoute = join(root, 'frontend', 'app', '(dashboard)', 'attendance', 'page.tsx');

const failures = [];
const fail = (rule, detail) => failures.push(`${rule}: ${detail}`);

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * Comments are prose, not code.
 *
 * Every rule below asks what the SOURCE does, so a doc comment that quotes a
 * forbidden pattern in order to explain why it is forbidden must not trip the
 * check. Block comments go entirely; line comments go only when the `//` opens
 * the line, so a `https://` inside a string survives.
 */
function stripComments(body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function v2Files() {
  if (!existsSync(v2Dir)) return [];
  return readdirSync(v2Dir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => {
      const raw = readFileSync(join(v2Dir, f), 'utf8');
      return { name: f, raw, body: stripComments(raw) };
    });
}

const files = v2Files();
if (files.length === 0) fail('setup', `no V2 components found under ${v2Dir}`);
if (!read(v2Route)) fail('setup', 'the hidden V2 route is missing');

// ── 1. The route stays hidden ───────────────────────────────────────────────
{
  const navDirs = [
    join(root, 'frontend', 'components'),
    join(root, 'frontend', 'app', '(dashboard)'),
    join(root, 'platforms'),
    join(root, 'apps'),
  ];
  const hits = [];
  const walk = (dir, depth = 0) => {
    if (!existsSync(dir) || depth > 6) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const body = stripComments(readFileSync(full, 'utf8'));
        // The route's own page file naturally names its path; a nav entry does
        // not, so only href/path declarations count as exposure.
        if (full === v2Route) continue;
        if (/(href|path|route)\s*:\s*['"`]\/attendance-v2/.test(body)) hits.push(full);
        if (/href=\{?['"`]\/attendance-v2/.test(body)) hits.push(full);
      }
    }
  };
  navDirs.forEach((d) => walk(d));
  if (hits.length > 0) {
    fail('rule 1 (hidden route)', `/attendance-v2 is linked from: ${hits.join(', ')}`);
  }
}

// ── 2. The live page is untouched ───────────────────────────────────────────
{
  const live = stripComments(read(liveRoute) ?? '') || null;
  if (!live) {
    fail('rule 2 (live page)', 'the live /attendance route is missing');
  } else {
    for (const required of ['AttendanceToday', 'AttendanceCalendar']) {
      if (!live.includes(required)) {
        fail('rule 2 (live page)', `/attendance no longer mounts ${required}`);
      }
    }
    if (live.includes('attendance-v2')) {
      fail('rule 2 (live page)', '/attendance references the V2 surface');
    }
  }
}

// ── 3. No figure is defaulted to zero ───────────────────────────────────────
for (const { name, body } of files) {
  // `?? 0` or `|| 0` on anything. The V2 tree has no legitimate use: a figure
  // is a number or it is unknown, and unknown renders as an em dash.
  const bad = body.match(/(\?\?|\|\|)\s*0\b/g);
  if (bad) fail('rule 3 (no zero default)', `${name} contains ${bad.join(', ')}`);
}

// ── 4. No frontend requirement constant ─────────────────────────────────────
for (const { name, body } of files) {
  if (/\b540\b/.test(body)) {
    fail('rule 4 (no hardcoded requirement)', `${name} contains the literal 540`);
  }
  if (/REQUIRED_PRESENCE_MINUTES/.test(body)) {
    fail('rule 4 (no hardcoded requirement)', `${name} references REQUIRED_PRESENCE_MINUTES`);
  }
}

// ── 5. No frontend presence arithmetic ──────────────────────────────────────
for (const { name, body } of files) {
  if (/assessPresence|attendance-presence/.test(body)) {
    fail('rule 5 (no frontend arithmetic)', `${name} imports the presence calculator`);
  }
  // punchOut − punchIn in any spelling.
  if (/getTime\(\)\s*-\s*[\w.]*punch/i.test(body) || /punchOut\w*\.getTime/i.test(body)) {
    fail('rule 5 (no frontend arithmetic)', `${name} computes a span from punch times`);
  }
}

// ── 6 & 7. Photos: drawer only, and never prefetched ────────────────────────
{
  const photoImporters = files.filter(({ body }) => /\bPunchPhoto\b/.test(body));
  for (const { name } of photoImporters) {
    if (name !== 'DayDetailDrawer.tsx') {
      fail('rule 6 (photos in drawer only)', `${name} renders PunchPhoto`);
    }
  }
  const drawer = files.find((f) => f.name === 'DayDetailDrawer.tsx');
  if (!drawer) {
    fail('rule 6 (photos in drawer only)', 'DayDetailDrawer.tsx is missing');
  } else if (!/showPhoto/.test(drawer.body)) {
    fail('rule 7 (no photo prefetch)', 'the photo is not behind an explicit action');
  }

  const calendar = files.find((f) => f.name === 'MonthCalendar.tsx');
  if (calendar && /(PunchPhoto|photoAssetId|<img)/.test(calendar.body)) {
    fail('rule 6 (photos in drawer only)', 'MonthCalendar references photo content');
  }
}

// ── 8. Colour is never the only indicator ───────────────────────────────────
{
  const presentation = files.find((f) => f.name === 'status-presentation.ts');
  if (!presentation) {
    fail('rule 8 (colour not alone)', 'status-presentation.ts is missing');
  } else {
    for (const key of ['label', 'color', 'tint', 'glyph']) {
      if (!new RegExp(`${key}:`).test(presentation.body)) {
        fail('rule 8 (colour not alone)', `the presentation type has no ${key}`);
      }
    }
    // ABSENT and UNRESOLVED must differ in colour AND glyph.
    const absent = presentation.body.match(/ABSENT:\s*\{[^}]*\}/)?.[0] ?? '';
    const unresolved = presentation.body.match(/UNRESOLVED:\s*\{[^}]*\}/)?.[0] ?? '';
    const colorOf = (s) => s.match(/color:\s*'([^']+)'/)?.[1];
    const glyphOf = (s) => s.match(/glyph:\s*'([^']+)'/)?.[1];
    if (!absent || !unresolved) {
      fail('rule 8 (colour not alone)', 'ABSENT or UNRESOLVED presentation is missing');
    } else if (colorOf(absent) === colorOf(unresolved) || glyphOf(absent) === glyphOf(unresolved)) {
      fail(
        'rule 8 (colour not alone)',
        'ABSENT and UNRESOLVED are not visually distinct in both colour and glyph',
      );
    }
  }
}

// ── 9. The banner is the server's ───────────────────────────────────────────
{
  const banner = files.find((f) => f.name === 'StatusBanner.tsx');
  if (!banner) {
    fail('rule 9 (server-owned banner)', 'StatusBanner.tsx is missing');
  } else if (/Workday still open|final status will be available/.test(banner.body)) {
    fail('rule 9 (server-owned banner)', 'StatusBanner hardcodes status copy');
  }
}

// ── 10. Presence and effective work are never mixed ─────────────────────────
{
  for (const { name, body } of files) {
    // Line-level, and deliberately crude: ANY line naming both the requirement
    // and worked minutes is rejected. An earlier version of this rule matched
    // an operator between the two identifiers, and a cast — `(x as number) -
    // (y as number)` — walked straight through it. There is no legitimate
    // reason for both names to share a line, so the shape of the expression
    // does not need to be understood to reject it.
    body.split(String.fromCharCode(10)).forEach((line, i) => {
      if (line.includes('requiredMinutes') && line.includes('workedMinutes')) {
        fail(
          'rule 10 (measures not mixed)',
          `${name}:${i + 1} names requiredMinutes and workedMinutes on one line`,
        );
      }
    });

    // The pre-ruling field names must not come back: they were ambiguous about
    // which measure they carried, which is how the mix-up happens.
    // Escape-free on purpose: a word-boundary escape in this file was once
    // written as a literal control byte, and the check then silently passed
    // everything. Removing the qualified names first leaves only the bare
    // ones to find.
    const bare = body
      .split('presenceRemainingMinutes')
      .join('')
      .split('presenceProgressPercent')
      .join('');
    if (bare.includes('remainingMinutes') || bare.includes('progressPercent')) {
      fail(
        'rule 10 (measures not mixed)',
        `${name} uses an unqualified remainingMinutes/progressPercent instead of the presence-named field`,
      );
    }
  }

  const card = files.find((f) => f.name === 'TodaySummaryCard.tsx');
  if (!card) {
    fail('rule 10 (measures not mixed)', 'TodaySummaryCard.tsx is missing');
  } else {
    for (const label of ['Required presence', 'Presence remaining', 'Presence progress']) {
      if (!card.raw.includes(label)) {
        fail('rule 10 (measures not mixed)', `the Today card does not label "${label}"`);
      }
    }
    // The bare labels would read as effective-work targets.
    if (/label="Required"/.test(card.body) || /label="Remaining"/.test(card.body)) {
      fail('rule 10 (measures not mixed)', 'the Today card uses an unqualified Required/Remaining label');
    }
  }

  const drawer = files.find((f) => f.name === 'DayDetailDrawer.tsx');
  if (drawer) {
    // The drawer must keep all three figures distinguishable.
    for (const label of ['Attendance presence', 'Required presence', 'Worked']) {
      if (!drawer.raw.includes(label)) {
        fail('rule 10 (measures not mixed)', `the drawer no longer shows "${label}"`);
      }
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error('My Attendance V2 surface verification FAILED\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('My Attendance V2 surface verification passed — all ten rules hold.');
