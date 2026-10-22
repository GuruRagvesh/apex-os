import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Phase 3 guard: every policy reader goes through the continuity resolver.
 *
 * A direct read of a policy table filtered on `status: 'ACTIVE'` (or the
 * `isActive` mirror) is exactly how a future version took over early, a gap
 * blocked a punch, or a superseded version stopped governing its own history.
 * This test fails on any NEW direct reader, so the bypass cannot creep back.
 */

const SRC = join(__dirname, '../../src');
const POLICY_TABLES = ['attendancePolicy', 'shiftPolicy', 'leavePolicy', 'holidayCalendar', 'weeklyOffPolicy'];

/**
 * Files allowed to read policy tables directly, and why. Each one reads
 * through resolveContinuousPolicy / GOVERNING_POLICY_STATUSES, or reads for a
 * reason that is not "which version governs a date".
 */
const ALLOWED = new Map<string, string>([
  ['modules/platform/attendance/policy/policy-version.service.ts', 'the resolver and lifecycle itself'],
  ['modules/platform/attendance/calendar/business-calendar.service.ts', 'calendar sources, through the resolver'],
  ['modules/platform/attendance/calendar/business-calendar.controller.ts', "a year's calendar, through the resolver"],
  ['modules/core/users/users.service.ts', 'onboarding bundle, through the resolver'],
  ['modules/platform/attendance/recovery/recovery-read.service.ts', 'maps historical references by id; resolves nothing'],
  ['modules/core/users/transitions/fnf/working-calendar.ts', 'F&F working calendar: the profile calendar and weekly-off policy in force on the last working day, by id'],
  ['modules/platform/settings/settings.service.ts', "Settings Center's governing leave version per series, through the resolver"],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

const READ = new RegExp(`\\.(${POLICY_TABLES.join('|')})\\.(findFirst|findMany|findUnique|count)\\(`, 'g');

describe('Phase 3: policy readers use the continuity resolver', () => {
  const files = walk(SRC).map((path) => ({ path, rel: relative(SRC, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));

  it('no file outside the allow-list reads a policy table directly', () => {
    const offenders = files
      .filter((f) => READ.test(f.text) && !ALLOWED.has(f.rel))
      .map((f) => f.rel);
    READ.lastIndex = 0;
    expect(offenders).toEqual([]);
  });

  it('no direct policy read filters on ACTIVE alone', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const match of f.text.matchAll(READ)) {
        // The call's own argument object, up to its closing parenthesis.
        const body = f.text.slice(match.index!, match.index! + 600);
        const call = body.slice(0, body.indexOf('});') + 3);
        const table = match[1];
        const activeOnly =
          /status:\s*'ACTIVE'/.test(call) ||
          /status:\s*PolicyStatus\.ACTIVE\b/.test(call) ||
          // isActive is the only approval signal an UNVERSIONED weekly-off row
          // has; for the versioned families it is a stale mirror.
          (table !== 'weeklyOffPolicy' && /isActive:\s*true/.test(call));
        if (activeOnly) offenders.push(`${f.rel}: ${table}.${match[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the governing statuses include SCHEDULED, so a future version takes over by date alone', () => {
    const continuity = readFileSync(join(SRC, 'modules/platform/attendance/policy/policy-continuity.ts'), 'utf8');
    expect(continuity).toMatch(/GOVERNING_POLICY_STATUSES = \['ACTIVE', 'SUPERSEDED', 'SCHEDULED'\]/);
  });
});
