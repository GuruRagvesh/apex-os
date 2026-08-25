import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assessProfileReadiness,
  classifyProfile,
  type ProfileReadinessRow,
} from '../../scripts/staging-preflight';

// The post-bootstrap preflight reported "Profiles without an assigned leave
// policy: 2" as a BLOCKER. Those two were the Manager and HR management-exempt
// profiles, which the attendance runtime never asks for a leave policy at all:
// daily-context.service reads assignedLeavePolicyId only inside its
// `coverage === 'COVERED'` branch, and there is no MISSING_LEAVE_POLICY in
// ContextBlockedReason for anybody. The blocker was the preflight's, not the
// data's, so the preflight is what changed.

const row = (over: Partial<ProfileReadinessRow> = {}): ProfileReadinessRow => ({
  email: 'someone@apex.local',
  userName: 'Someone',
  roleName: 'EMPLOYEE',
  hasProfile: true,
  category: 'REGULAR_EMPLOYEE',
  attendanceRequired: true,
  assignedShiftId: 'shift',
  assignedHolidayCalendarId: 'calendar',
  assignedWeeklyOffPolicyId: 'weekly',
  assignedLeavePolicyId: 'leave',
  assignedAttendanceLocationId: 'location',
  ...over,
});

describe('preflight profile applicability', () => {
  it('mirrors the runtime coverage rules', () => {
    expect(classifyProfile(row())).toBe('COVERED');
    expect(classifyProfile(row({ hasProfile: false }))).toBe('NO_PROFILE');
    expect(classifyProfile(row({ category: 'MANAGEMENT_EXEMPT' }))).toBe('EXEMPT');
    expect(classifyProfile(row({ attendanceRequired: false }))).toBe('EXEMPT');
  });

  it('treats MANAGEMENT_EXEMPT as exempt even when attendance is still required', () => {
    // resolveCoverage checks the category BEFORE attendanceRequired, so the
    // category alone decides. Reversing that here would re-block the manager.
    expect(
      classifyProfile(row({ category: 'MANAGEMENT_EXEMPT', attendanceRequired: true })),
    ).toBe('EXEMPT');
  });
});

describe('leave policy applicability', () => {
  it('does not count an exempt profile as missing a leave policy', () => {
    const a = assessProfileReadiness([
      row({ category: 'MANAGEMENT_EXEMPT', attendanceRequired: false, assignedLeavePolicyId: null }),
    ]);

    expect(a.missing.leavePolicy).toBe(0);
    expect(a.exemptWithout.leavePolicy).toBe(1);
    expect(a.exempt).toBe(1);
    expect(a.covered).toBe(0);
  });

  it('does not let a null leave policy make a management-exempt profile blocked', () => {
    // The exact staging shape: Manager and HR, both MANAGEMENT_EXEMPT with
    // attendanceRequired false and no leave policy.
    const a = assessProfileReadiness([
      row({
        email: 'attendance-e2e-manager@apex.local',
        category: 'MANAGEMENT_EXEMPT',
        attendanceRequired: false,
        assignedLeavePolicyId: null,
      }),
      row({
        email: 'attendance-e2e-hr@apex.local',
        category: 'MANAGEMENT_EXEMPT',
        attendanceRequired: false,
        assignedLeavePolicyId: null,
      }),
      row({ email: 'attendance-e2e-employee@apex.local' }),
    ]);

    expect(a.missing.leavePolicy).toBe(0);
    expect(a.missing.shift).toBe(0);
    expect(a.missing.calendar).toBe(0);
    expect(a.missing.weeklyOff).toBe(0);
    expect(a.covered).toBe(1);
    expect(a.exempt).toBe(2);
    expect(a.missingProfile).toBe(0);
  });

  it('still counts a covered profile that has no leave policy', () => {
    const a = assessProfileReadiness([row({ assignedLeavePolicyId: null })]);

    expect(a.missing.leavePolicy).toBe(1);
    expect(a.exemptWithout.leavePolicy).toBe(0);
  });

  it('counts nothing when a covered profile has its leave policy', () => {
    const a = assessProfileReadiness([row()]);

    expect(a.missing.leavePolicy).toBe(0);
    expect(a.exemptWithout.leavePolicy).toBe(0);
    expect(a.withoutLeavePolicy).toEqual([]);
  });

  it('names the profiles that have no leave policy, so the count is actionable', () => {
    const a = assessProfileReadiness([
      row({
        email: 'attendance-e2e-manager@apex.local',
        userName: 'Staging Attendance Manager',
        roleName: 'MANAGER',
        category: 'MANAGEMENT_EXEMPT',
        attendanceRequired: false,
        assignedLeavePolicyId: null,
      }),
      row(),
    ]);

    expect(a.withoutLeavePolicy).toEqual([
      {
        email: 'attendance-e2e-manager@apex.local',
        userName: 'Staging Attendance Manager',
        roleName: 'MANAGER',
        applicability: 'EXEMPT',
        category: 'MANAGEMENT_EXEMPT',
        attendanceRequired: false,
      },
    ]);
  });
});

describe('shift, calendar and weekly-off applicability', () => {
  it('blocks a covered profile that is missing any of the three', () => {
    const a = assessProfileReadiness([
      row({ assignedShiftId: null }),
      row({ assignedHolidayCalendarId: null }),
      row({ assignedWeeklyOffPolicyId: null }),
    ]);

    expect(a.missing.shift).toBe(1);
    expect(a.missing.calendar).toBe(1);
    expect(a.missing.weeklyOff).toBe(1);
    expect(a.covered).toBe(3);
  });

  it('does not block an exempt profile that is missing all three', () => {
    // MISSING_SHIFT_ASSIGNMENT, MISSING_HOLIDAY_CALENDAR and
    // MISSING_WEEKLY_OFF_POLICY are pushed only inside the COVERED branch.
    const a = assessProfileReadiness([
      row({
        attendanceRequired: false,
        assignedShiftId: null,
        assignedHolidayCalendarId: null,
        assignedWeeklyOffPolicyId: null,
      }),
    ]);

    expect(a.missing.shift).toBe(0);
    expect(a.missing.calendar).toBe(0);
    expect(a.missing.weeklyOff).toBe(0);
    expect(a.exemptWithout).toEqual({ shift: 1, calendar: 1, weeklyOff: 1, leavePolicy: 0 });
  });

  it('counts a location gap only for covered profiles', () => {
    const a = assessProfileReadiness([
      row({ assignedAttendanceLocationId: null }),
      row({ attendanceRequired: false, assignedAttendanceLocationId: null }),
    ]);

    expect(a.missing.location).toBe(1);
  });

  it('keeps a missing profile separate from an exempt one', () => {
    // "No profile" is UNRESOLVED, which really is a blocker; "exempt" is not.
    const a = assessProfileReadiness([
      row({ hasProfile: false, category: null, attendanceRequired: null }),
      row({ attendanceRequired: false }),
    ]);

    expect(a.missingProfile).toBe(1);
    expect(a.exempt).toBe(1);
    expect(a.covered).toBe(0);
  });
});

describe('preflight remains read-only and testable', () => {
  const SOURCE = readFileSync(
    resolve(__dirname, '../../scripts/staging-preflight.ts'),
    'utf8',
  );
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('performs no write of any kind', () => {
    for (const forbidden of [
      '.create(',
      '.createMany(',
      '.update(',
      '.updateMany(',
      '.upsert(',
      '.delete(',
      '.deleteMany(',
      '$executeRaw',
    ]) {
      expect(CODE).not.toContain(forbidden);
    }
    expect(CODE).not.toMatch(/--apply/);
  });

  it('does not connect merely because a test imported it', () => {
    // Importing this file at the top of this spec must not run main().
    expect(CODE).toMatch(/if \(require\.main === module\)/);
  });

  it('keeps the staging identity gate intact', () => {
    expect(SOURCE).toMatch(/EXPECTED_STAGING_DB_HOST/);
    expect(SOURCE).toMatch(/EXPECTED_STAGING_DB_NAME/);
    expect(SOURCE).toMatch(/dpg-d8259omk1jcs73e37fbg/);
  });

  it('reports the leave-policy gap without blocking on it', () => {
    expect(CODE).toMatch(
      /assessment\.missing\.leavePolicy > 0 \? 'WARNING' : 'PASS'/,
    );
    // Shift, calendar and weekly-off stay blockers for covered employees.
    expect(CODE).toMatch(/\['shift', assessment\.missing\.shift\]/);
    expect(CODE).toMatch(/value > 0 \? 'BLOCKER' : 'PASS'/);
  });
});
