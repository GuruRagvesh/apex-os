import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AttendanceCategory } from '@prisma/client';
import { applyLegacyEmploymentFallback } from '../../src/modules/platform/attendance/context/legacy-employment-fallback';
import type {
  AttendanceProfileFacts,
  EmploymentFacts,
} from '../../src/modules/platform/attendance/timeline/employee-timeline.types';

// users.joiningDate is nullable and was never populated for staff predating
// Attendance. The production bootstrap does not set it; the staging E2E
// bootstrap does, which is why staging never surfaced this and production did,
// for all 36 employees at once: every punch was refused NOT_EMPLOYED.
//
// The fix treats a no-joining-date employee as attendance-applicable from
// their profile's effectiveFrom, rather than inventing an HR joining date.

const TODAY = '2026-08-27';

const employment = (over: Partial<EmploymentFacts> = {}): EmploymentFacts => ({
  employedOnDate: false,
  joiningDate: null,
  lastWorkingDate: null,
  reason: 'NO_JOINING_DATE',
  ...over,
});

const profile = (over: Partial<AttendanceProfileFacts> = {}): AttendanceProfileFacts => ({
  profileId: 'profile-1',
  category: AttendanceCategory.REGULAR_EMPLOYEE,
  attendanceRequired: true,
  assignedShiftId: 'shift-1',
  assignedLeavePolicyId: 'leave-1',
  assignedHolidayCalendarId: 'cal-1',
  assignedWeeklyOffPolicyId: 'weekly-1',
  assignedAttendanceLocationId: null,
  reportingManagerId: null,
  hrReviewerId: null,
  effectiveFrom: TODAY,
  effectiveTo: null,
  ...over,
});

/** The timeline's answer for a no-joining-date employee, before the fallback. */
const notEmployed = (over: Partial<Parameters<typeof applyLegacyEmploymentFallback>[0]> = {}) => ({
  coverage: 'NOT_EMPLOYED' as const,
  coverageReason: 'NO_JOINING_DATE' as const,
  employment: employment(),
  profile: profile(),
  businessDate: TODAY,
  ...over,
});

describe('A. null joiningDate with a profile in force today', () => {
  it('becomes COVERED', () => {
    const result = applyLegacyEmploymentFallback(notEmployed());

    expect(result.coverage).toBe('COVERED');
    expect(result.coverageReason).toBe('COVERED');
    expect(result.legacyFallbackApplied).toBe(true);
  });
});

describe('B/C. the profile window is the applicability boundary', () => {
  // resolveEmployeeOn only returns a profile that is in force on the date, so
  // "starts tomorrow" and "date before effectiveFrom" both reach here as a
  // null profile -- the query has already excluded it.
  it('B. a profile starting tomorrow is not in force, so today stays NOT_EMPLOYED', () => {
    const result = applyLegacyEmploymentFallback(notEmployed({ profile: null }));

    expect(result.coverage).toBe('NOT_EMPLOYED');
    expect(result.legacyFallbackApplied).toBe(false);
  });

  it('C. a date before effectiveFrom stays NOT_EMPLOYED', () => {
    const result = applyLegacyEmploymentFallback(
      notEmployed({ profile: null, businessDate: '2026-08-26' }),
    );

    expect(result.coverage).toBe('NOT_EMPLOYED');
    expect(result.legacyFallbackApplied).toBe(false);
  });

  it('applies on the effectiveFrom date itself, which is inclusive', () => {
    const result = applyLegacyEmploymentFallback(
      notEmployed({ profile: profile({ effectiveFrom: TODAY }), businessDate: TODAY }),
    );

    expect(result.coverage).toBe('COVERED');
  });
});

describe('D/E. an explicit joiningDate always wins', () => {
  it('D. a future joining date stays NOT_EMPLOYED even with a profile', () => {
    const result = applyLegacyEmploymentFallback(
      notEmployed({
        coverageReason: 'BEFORE_JOINING',
        employment: employment({ joiningDate: '2026-09-01', reason: 'BEFORE_JOINING' }),
      }),
    );

    expect(result.coverage).toBe('NOT_EMPLOYED');
    expect(result.coverageReason).toBe('BEFORE_JOINING');
    expect(result.legacyFallbackApplied).toBe(false);
  });

  it('E. a past joining date is untouched: the fallback never runs', () => {
    const employed = {
      coverage: 'COVERED' as const,
      coverageReason: 'COVERED' as const,
      employment: employment({
        employedOnDate: true,
        joiningDate: '2024-01-15',
        reason: 'EMPLOYED',
      }),
      profile: profile(),
      businessDate: TODAY,
    };
    const result = applyLegacyEmploymentFallback(employed);

    expect(result).toEqual({
      coverage: 'COVERED',
      coverageReason: 'COVERED',
      legacyFallbackApplied: false,
    });
  });
});

describe('F. lastWorkingDate still terminates employment', () => {
  // The trap this test exists for: employmentOn() returns NO_JOINING_DATE
  // BEFORE it ever reads lastWorkingDate, so a leaver with no joining date
  // arrives here looking exactly like an active employee. Without the explicit
  // check, terminated staff would become punchable.
  it('a past lastWorkingDate stays NOT_EMPLOYED even with a covering profile', () => {
    const result = applyLegacyEmploymentFallback(
      notEmployed({
        employment: employment({ lastWorkingDate: '2026-07-31' }),
      }),
    );

    expect(result.coverage).toBe('NOT_EMPLOYED');
    expect(result.legacyFallbackApplied).toBe(false);
  });

  it('is inclusive: the last working day itself is still applicable', () => {
    const result = applyLegacyEmploymentFallback(
      notEmployed({ employment: employment({ lastWorkingDate: TODAY }) }),
    );

    expect(result.coverage).toBe('COVERED');
  });

  it('a future lastWorkingDate does not block today', () => {
    const result = applyLegacyEmploymentFallback(
      notEmployed({ employment: employment({ lastWorkingDate: '2026-12-31' }) }),
    );

    expect(result.coverage).toBe('COVERED');
  });
});

describe('G. no covering profile fails closed', () => {
  it('stays NOT_EMPLOYED rather than becoming silently applicable', () => {
    const result = applyLegacyEmploymentFallback(notEmployed({ profile: null }));

    expect(result.coverage).toBe('NOT_EMPLOYED');
    expect(result.coverageReason).toBe('NO_JOINING_DATE');
    expect(result.legacyFallbackApplied).toBe(false);
  });
});

describe('the profile decides EXEMPT vs COVERED, by the timeline rules', () => {
  it('MANAGEMENT_EXEMPT becomes EXEMPT, not COVERED', () => {
    const result = applyLegacyEmploymentFallback(
      notEmployed({ profile: profile({ category: AttendanceCategory.MANAGEMENT_EXEMPT }) }),
    );

    expect(result.coverage).toBe('EXEMPT');
    expect(result.coverageReason).toBe('MANAGEMENT_EXEMPT_CATEGORY');
  });

  it('attendanceRequired false becomes EXEMPT', () => {
    const result = applyLegacyEmploymentFallback(
      notEmployed({ profile: profile({ attendanceRequired: false }) }),
    );

    expect(result.coverage).toBe('EXEMPT');
    expect(result.coverageReason).toBe('ATTENDANCE_NOT_REQUIRED');
  });
});

describe('other employment answers are never rewritten', () => {
  it.each([
    ['USER_NOT_FOUND'],
    ['AFTER_LAST_WORKING_DATE'],
    ['BEFORE_JOINING'],
  ] as const)('leaves %s alone', (reason) => {
    const result = applyLegacyEmploymentFallback(
      notEmployed({
        coverageReason: reason,
        employment: employment({ reason: reason as EmploymentFacts['reason'] }),
      }),
    );

    expect(result.coverage).toBe('NOT_EMPLOYED');
    expect(result.coverageReason).toBe(reason);
    expect(result.legacyFallbackApplied).toBe(false);
  });

  it('never converts UNRESOLVED into coverage', () => {
    // A configuration gap must stay a gap, not become an exemption.
    const result = applyLegacyEmploymentFallback(
      notEmployed({ coverage: 'UNRESOLVED' as any, coverageReason: 'NO_PROFILE_FOR_DATE' }),
    );

    expect(result.coverage).toBe('UNRESOLVED');
    expect(result.legacyFallbackApplied).toBe(false);
  });
});

describe('H. the fallback is attendance-only', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');

  it('is not referenced by the leave or comp-off services', () => {
    // EmployeeTimelineService is shared with leave. Relaxing employment there
    // would change leave semantics as a side effect, so the rule lives in the
    // attendance context layer instead.
    expect(read('modules/operations/leave/leave-working-day.service.ts')).not.toMatch(
      /applyLegacyEmploymentFallback/,
    );
    expect(read('modules/operations/leave/comp-off.service.ts')).not.toMatch(
      /applyLegacyEmploymentFallback/,
    );
  });

  it('does not modify the shared employment resolver', () => {
    const timeline = read('modules/platform/attendance/timeline/employee-timeline.service.ts');

    expect(timeline).not.toMatch(/applyLegacyEmploymentFallback/);
    expect(timeline).not.toMatch(/legacyFallback/);
  });

  it('is applied by the attendance daily-context resolver', () => {
    expect(read('modules/platform/attendance/context/daily-context.service.ts')).toMatch(
      /applyLegacyEmploymentFallback\(/,
    );
  });

  it('never touches the database: the rule is pure', () => {
    // Importing the AttendanceCategory enum from '@prisma/client' is a type
    // import, not database access, so the check is for actual I/O.
    const src = read('modules/platform/attendance/context/legacy-employment-fallback.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/PrismaService|this\.prisma|prisma\./);
    expect(code).not.toMatch(/\.(update|create|upsert|delete)(Many)?\(/);
    expect(code).not.toMatch(/\basync\b|\bawait\b/);
  });
});
