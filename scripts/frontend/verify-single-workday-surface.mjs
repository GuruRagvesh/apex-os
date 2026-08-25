#!/usr/bin/env node
/**
 * Apex OS — single Workday control surface verifier.
 *
 * WHY THIS EXISTS
 * ---------------
 * WorkdayBar owns the interactive Workday controls: Start Work, Break, Resume
 * and End Day. With Attendance V2 on, Start Work and End Day open PunchModal
 * and the server starts or finalises the session in the same transaction that
 * records the punch evidence.
 *
 * Rendering it twice puts two live copies of those controls on one page. The
 * duplicate is easy to introduce by accident: a grep scoped to frontend/ does
 * not see the mount in platforms/intelligence/dashboard, so the component
 * looks unmounted and a second mount gets added to the shared layout. That is
 * exactly how it happened once.
 *
 * A duplicate is not corrupting on its own — startWork reuses an open session
 * without resetting startWorkAt, and finalize is idempotent — but two sets of
 * identical buttons is a defect the build otherwise cannot see.
 *
 * Node built-ins only. Reads files, touches nothing else.
 *
 * It also checks the second half of the same rule: QuickActionDock must not
 * call the Workday lifecycle mutations itself. The dock is present on every
 * page, so running those there created a second independent action path for
 * one lifecycle -- and a second place the punch requirement would have to be
 * re-enforced correctly. It navigates to the dashboard instead.
 *
 * Exit 0 = exactly one mount AND no lifecycle mutation in the dock.
 * Exit 1 = anything else.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOTS = ['frontend', 'platforms', 'apps'];
const SKIP = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

/** JSX mount, not the import line and not the definition. */
const MOUNT = /<WorkdayBar[\s/>]/g;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const mounts = [];
for (const root of ROOTS) {
  for (const file of walk(join(REPO_ROOT, root))) {
    // The component's own file defines it; it does not mount it.
    if (file.endsWith('WorkdayBar.tsx')) continue;
    const matches = readFileSync(file, 'utf8').match(MOUNT);
    if (matches) {
      mounts.push({ file: relative(REPO_ROOT, file), count: matches.length });
    }
  }
}

const total = mounts.reduce((sum, m) => sum + m.count, 0);

// ── rule 2: the dock must not mutate the Workday lifecycle ──────────────────
const DOCK = join(REPO_ROOT, 'frontend', 'components', 'ui', 'QuickActionDock.tsx');

/**
 * Lifecycle mutations, by the call the dock would have to make.
 *
 * Reads are not listed: asking what the workday currently is stays fine. Only
 * changing it is reserved to WorkdayBar.
 */
const FORBIDDEN_IN_DOCK = [
  /workdayApi\.startWork\s*\(/,
  /workdayApi\.endWork\s*\(/,
  /workdayApi\.resumeWork\s*\(/,
  /workdayApi\.startBreak\s*\(/,
  /workdayApi\.endBreak\s*\(/,
  // Punching is the same lifecycle wearing a different name.
  /<PunchModal/,
  /submitPunch\s*\(/,
  /uploadPunchPhoto\s*\(/,
];

const dockViolations = [];
let dockSource = '';
try {
  dockSource = readFileSync(DOCK, 'utf8');
} catch {
  dockViolations.push('QuickActionDock.tsx not found at its expected path');
}

if (dockSource) {
  // Comments explain why these calls are absent; they are not the calls.
  const code = dockSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const pattern of FORBIDDEN_IN_DOCK) {
    if (pattern.test(code)) dockViolations.push(String(pattern));
  }
}

if (total === 1 && dockViolations.length === 0) {
  console.log(`[workday] OK — one Workday control surface: ${mounts[0].file}`);
  console.log('[workday] OK — QuickActionDock performs no lifecycle mutation');
  process.exit(0);
}

if (dockViolations.length > 0) {
  console.error('[workday] QuickActionDock executes Workday lifecycle actions:');
  for (const v of dockViolations) console.error(`  ${v}`);
  console.error('[workday] Only WorkdayBar may do that -- it is what enforces the');
  console.error('[workday] punch requirement. The dock should navigate to /dashboard.');
  process.exit(1);
}

if (total === 0) {
  console.error('[workday] No <WorkdayBar /> mount found.');
  console.error('[workday] Nothing renders Start Work / Break / Resume / End Day,');
  console.error('[workday] so an employee cannot punch in from the UI at all.');
  process.exit(1);
}

console.error(`[workday] ${total} <WorkdayBar /> mounts, expected exactly 1:`);
for (const m of mounts) {
  console.error(`  ${m.file}${m.count > 1 ? ` (x${m.count})` : ''}`);
}
console.error('[workday] Two copies of the interactive controls render on the same page.');
console.error('[workday] Keep the dashboard mount; it is the authoritative surface.');
process.exit(1);
