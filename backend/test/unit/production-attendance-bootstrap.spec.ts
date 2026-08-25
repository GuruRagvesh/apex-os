import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PolicyStatus } from '@prisma/client';
import {
  buildProductionPolicies,
  decideCoverage,
  maskIdentity,
  parseApprovedExemptions,
  PRODUCTION_ATTENDANCE_V2,
  PRODUCTION_POLICY,
} from '../../scripts/bootstrap-production-attendance';

// This script writes to the live company database. The tests that matter most
// are not that it produces the right policy numbers, but that it CANNOT decide
// on its own that somebody is exempt from attendance — an inferred exemption
// would silently excuse a real employee and only surface at payroll.

const SOURCE = readFileSync(
  resolve(__dirname, '../../scripts/bootstrap-production-attendance.ts'),
  'utf8',
);
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const employee = (over: Partial<Parameters<typeof decideCoverage>[0]> = {}) => ({
  id: 'u1',
  employeeId: 'TE-001',
  existingCategory: null,
  ...over,
});

describe('exemption is never inferred', () => {
  it('covers an ordinary employee', () => {
    expect(decideCoverage(employee(), new Set())).toEqual({
      category: 'REGULAR_EMPLOYEE',
      source: 'DEFAULT_COVERED',
    });
  });

  it('honours an exemption somebody already recorded on a profile', () => {
    const d = decideCoverage(employee({ existingCategory: 'MANAGEMENT_EXEMPT' }), new Set());

    expect(d).toEqual({ category: 'MANAGEMENT_EXEMPT', source: 'EXISTING_PROFILE' });
  });

  it('honours an explicitly approved employeeId', () => {
    const d = decideCoverage(employee(), new Set(['TE-001']));

    expect(d).toEqual({ category: 'MANAGEMENT_EXEMPT', source: 'APPROVED_INPUT' });
  });

  it('covers everyone when no exemption list is supplied', () => {
    for (const id of ['TE-001', 'TE-002', 'TE-100']) {
      expect(decideCoverage(employee({ employeeId: id }), new Set()).category).toBe(
        'REGULAR_EMPLOYEE',
      );
    }
  });

  it('takes no role, level, title or name to decide from', () => {
    const signature = /export function decideCoverage\(\s*employee: EmployeeFacts,\s*approvedExemptEmployeeIds: ReadonlySet<string>,\s*\)/;
    expect(SOURCE).toMatch(signature);

    const facts = /export interface EmployeeFacts \{([\s\S]*?)\}/.exec(SOURCE)![1];
    // PREFIX match, not \bword\b: `roleName` contains no boundary after
    // "role", so a whole-word pattern would let exactly the field we are
    // trying to forbid slip through.
    for (const forbidden of ['role', 'level', 'title', 'isHR', 'designation', 'grade', 'manager']) {
      expect(facts).not.toMatch(new RegExp(forbidden, 'i'));
    }
  });

  it('ignores any role-like field even if one is added to the input', () => {
    // The structural check above can only forbid names somebody thought of.
    // This one is behavioural: whatever the field is called, feeding it in
    // must not change the answer.
    for (const extra of [
      { roleName: 'MANAGER' },
      { role: { name: 'ADMIN', level: 1 } },
      { roleLevel: 0 },
      { jobTitle: 'Head of Engineering' },
      { isHR: true },
      { designation: 'Director' },
    ]) {
      const d = decideCoverage({ ...employee(), ...(extra as any) }, new Set());
      expect(d).toEqual({ category: 'REGULAR_EMPLOYEE', source: 'DEFAULT_COVERED' });
    }
  });

  it('reaches MANAGEMENT_EXEMPT through exactly two sources, and no third', () => {
    // If a new branch is ever added, its source string will not be one of
    // these two and this fails.
    const sources = [...SOURCE.matchAll(/source: '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(new Set(sources)).toEqual(
      new Set(['EXISTING_PROFILE', 'APPROVED_INPUT', 'DEFAULT_COVERED']),
    );
    const exemptReturns = [...CODE.matchAll(/category: 'MANAGEMENT_EXEMPT', source: '([A-Z_]+)'/g)]
      .map((m) => m[1]);
    expect(exemptReturns.sort()).toEqual(['APPROVED_INPUT', 'EXISTING_PROFILE']);
  });

  it('does not treat a covered employee as exempt just because a profile exists', () => {
    const d = decideCoverage(employee({ existingCategory: 'REGULAR_EMPLOYEE' }), new Set());

    expect(d.category).toBe('REGULAR_EMPLOYEE');
  });

  it('cannot match an employee who has no employeeId against the approved list', () => {
    // A null employeeId must not accidentally match a blank list entry.
    const d = decideCoverage(employee({ employeeId: null }), new Set(['']));

    expect(d.category).toBe('REGULAR_EMPLOYEE');
  });

  it('ignores blank and whitespace entries in the approved list', () => {
    expect(parseApprovedExemptions('  ')).toEqual(new Set());
    expect(parseApprovedExemptions(',,')).toEqual(new Set());
    expect(parseApprovedExemptions(undefined)).toEqual(new Set());
    expect(parseApprovedExemptions(' TE-001 , TE-002 ')).toEqual(new Set(['TE-001', 'TE-002']));
  });
});

describe('approved company policy', () => {
  const policies = buildProductionPolicies({
    financialYear: '2026-2027',
    effectiveFrom: new Date('2026-08-25T00:00:00.000Z'),
    attendancePolicyId: 'ap',
    shiftId: 'sh',
    weeklyOffId: 'wo',
    leavePolicyId: 'lp',
    createdById: 'actor',
  });

  it('encodes the punch window as 09:30 to 10:30 inclusive', () => {
    expect(PRODUCTION_POLICY.punchInEarliest).toBe('09:30');
    expect(PRODUCTION_POLICY.punchInLatest).toBe('10:30');
    expect(policies.shift.startTime).toBe('09:30');
    // 09:30 start + 60 grace = 10:30 latest acceptable arrival.
    expect(policies.shift.graceMinutes).toBe(60);
  });

  it('sends a late arrival to review rather than penalising it', () => {
    expect(policies.attendancePolicy.afterPunchWindowAction).toBe('REQUIRE_REVIEW');
    expect(policies.attendancePolicy.insufficientHoursAction).toBe('REQUIRE_REVIEW');
  });

  it('separates the three duration measures', () => {
    expect(policies.attendancePolicy.minimumWorkingMinutes).toBe(540);
    expect(policies.attendancePolicy.permittedBreakMinutes).toBe(60);
    // Unset on purpose: management has not defined an effective-work floor,
    // and a number invented here would silently become policy.
    expect(policies.attendancePolicy.minimumEffectiveWorkMinutes).toBeNull();
  });

  it('never infers a half day', () => {
    expect(policies.attendancePolicy.automaticHalfDayEnabled).toBe(false);
  });

  it('sets the weekly off to Sunday and the 2nd and 4th Saturday only', () => {
    expect(policies.weeklyOff.everySunday).toBe(true);
    expect(policies.weeklyOff.secondSaturday).toBe(true);
    expect(policies.weeklyOff.fourthSaturday).toBe(true);
    // No fifth-Saturday field is set, because no such rule was approved.
    expect(Object.keys(policies.weeklyOff)).not.toContain('fifthSaturday');
  });

  it('keeps Casual and Emergency as separate pools', () => {
    expect(policies.leavePolicy.casualLeaveAllocation).toBe(10);
    expect(policies.leavePolicy.emergencyLeaveAllocation).toBe(4);
    // An empty combined pool is what stops one consuming the other.
    expect(policies.leavePolicy.combinedPoolTypes).toEqual([]);
  });

  it('expires comp off 30 days after the source date', () => {
    expect(policies.leavePolicy.compOffExpiryDays).toBe(30);
  });

  it('encodes both half-day windows', () => {
    expect(policies.leavePolicy.firstHalfInEarliest).toBe('09:30');
    expect(policies.leavePolicy.firstHalfInLatest).toBe('10:30');
    expect(policies.leavePolicy.firstHalfRequiredPresenceMinutes).toBe(240);
    expect(policies.leavePolicy.secondHalfInEarliest).toBe('14:00');
    expect(policies.leavePolicy.secondHalfInLatest).toBe('14:30');
    expect(policies.leavePolicy.secondHalfOutTime).toBe('18:30');
  });

  it('leaves geofencing off, since no coordinates were approved', () => {
    expect(policies.attendancePolicy.geoFenceEnabled).toBe(false);
  });

  it('creates the policies ACTIVE and effective from the run date', () => {
    for (const p of [policies.attendancePolicy, policies.shift, policies.leavePolicy]) {
      expect(p.status).toBe(PolicyStatus.ACTIVE);
      expect(p.isActive).toBe(true);
      expect(p.version).toBe(1);
      expect(p.policyKey).toBe(p.id);
    }
  });
});

describe('initial production flags', () => {
  it('gives employees attendance but leaves the scheduler off', () => {
    expect(PRODUCTION_ATTENDANCE_V2).toEqual({
      punchEvidenceEnabled: true,
      leaveAuthorityEnabled: true,
      leaveApprovalEnabled: true,
      regularizationEnabled: true,
      automaticEvaluationEnabled: false,
      shadowEnabled: false,
      officialWriteEnabled: false,
    });
  });

  it('never ships the ambiguous shadow+official combination', () => {
    const both =
      PRODUCTION_ATTENDANCE_V2.shadowEnabled && PRODUCTION_ATTENDANCE_V2.officialWriteEnabled;
    expect(both).toBe(false);
  });
});

describe('production safety gate', () => {
  it('requires a positive production assertion, not merely a non-staging one', () => {
    expect(SOURCE).toMatch(/appEnv !== 'production'/);
    expect(SOURCE).toMatch(/EXPECTED_PRODUCTION_DB_HOST/);
    expect(SOURCE).toMatch(/EXPECTED_PRODUCTION_DB_NAME/);
    expect(SOURCE).toMatch(/Host mismatch/);
    expect(SOURCE).toMatch(/Database mismatch/);
  });

  it('refuses a staging target', () => {
    expect(SOURCE).toMatch(/dpg-d95pamvaqgkc73fdurig/);
    expect(SOURCE).toMatch(/apex_os_staging/);
  });

  it('masks identity rather than printing it', () => {
    expect(maskIdentity('dpg-abcdefghijkl-a.oregon-postgres.render.com')).not.toContain('oregon');
    expect(maskIdentity('apex_db_dugl')).not.toBe('apex_db_dugl');
    expect(maskIdentity('short')).toBe('***');
  });

  it('requires an explicit --apply and dry-runs otherwise', () => {
    expect(SOURCE).toMatch(/const APPLY = process\.argv\.includes\('--apply'\)/);
    expect(SOURCE).toMatch(/if \(!APPLY\)/);
    expect(SOURCE).toMatch(/DRY RUN COMPLETE\. Nothing was written\./);
  });

  it('performs no delete, reset, seed or repair of any kind', () => {
    for (const forbidden of [
      'deleteMany',
      '.delete(',
      'migrate reset',
      'db push',
      '$executeRaw',
      'TRUNCATE',
    ]) {
      expect(CODE).not.toContain(forbidden);
    }
    expect(CODE).not.toMatch(/from '.*seed'/);
  });

  it('creates no synthetic user or department', () => {
    // The staging bootstrap creates three E2E users and a department. This one
    // discovers the real workforce and must never invent people.
    expect(CODE).not.toMatch(/prisma\.user\.create/);
    expect(CODE).not.toMatch(/prisma\.department\.create/);
    expect(CODE).not.toMatch(/attendance-e2e-/);
    expect(CODE).not.toMatch(/apex\.local/);
    expect(CODE).not.toMatch(/bcrypt/);
  });

  it('refuses when more than one active authority already exists', () => {
    expect(SOURCE).toMatch(/resolveSingle/);
    expect(SOURCE).toMatch(/cannot say which/);
    expect(SOURCE).toMatch(/Refusing to write while the picture is ambiguous/);
  });

  it('refuses an approved exemption that matches nobody', () => {
    // A typo would otherwise leave somebody covered who was meant to be exempt.
    expect(SOURCE).toMatch(/matching\b[\s\S]{0,40}no active employee/);
  });

  it('writes everything in one transaction', () => {
    expect(SOURCE).toMatch(/prisma\.\$transaction\(operations\)/);
  });

  it('is importable without connecting', () => {
    expect(SOURCE).toMatch(/if \(require\.main === module\)/);
  });

  it('stops when no holiday calendar exists for the year', () => {
    // Without one, every working-day question resolves BLOCKED.
    expect(SOURCE).toMatch(/No ACTIVE HolidayCalendar/);
  });
});
