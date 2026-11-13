import {
  currentFyStartYear,
  financialYearMonths,
  fyLabel,
  lastMonths,
  limitConcurrency,
  matchesRosterFilter,
  recurringIssues,
  type RosterFilter,
} from '../../../frontend/components/attendance/analytics/analytics-data';

/**
 * Attendance Console analytics helpers, imported straight out of the frontend
 * tree (the frontend has no test runner; see attendance-register-export.spec).
 *
 * Year boundaries are where month arithmetic breaks: January needs last year's
 * April, and 31 March still belongs to last year's financial year. The roster
 * filter must select exactly the people the server counts for each tile.
 */
describe('attendance analytics: financial year and month ranges', () => {
  it('starts the financial year in April', () => {
    expect(currentFyStartYear('2026-03-31')).toBe(2025);
    expect(currentFyStartYear('2026-04-01')).toBe(2026);
    expect(currentFyStartYear('2027-01-15')).toBe(2026);
  });

  it('lists only months that have started, crossing into the next calendar year', () => {
    expect(financialYearMonths(2026, '2026-11-13')).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
    ]);
    const january = financialYearMonths(2025, '2026-01-05');
    expect(january[0]).toBe('2025-04');
    expect(january[january.length - 1]).toBe('2026-01');
    expect(january).toHaveLength(10);
    expect(financialYearMonths(2025, '2026-06-01')).toHaveLength(12);
    expect(financialYearMonths(2026, '2026-03-31')).toEqual([]);
  });

  it('counts the last N months back across a year end, oldest first', () => {
    expect(lastMonths(3, '2026-01-10')).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(lastMonths(12, '2026-11-13')[0]).toBe('2025-12');
  });

  it('labels a year that ends in a new century', () => {
    expect(fyLabel(2026)).toBe('FY 2026–27');
    expect(fyLabel(2099)).toBe('FY 2099–00');
  });
});

describe('attendance analytics: recurring issues', () => {
  const employee = (userId: string, late: number) => ({
    isActive: true, userId, name: userId, employeeId: null, avatar: null, photoUrl: null, department: 'Ops',
    daysPresent: 20, daysAbsent: 0, halfDays: 0, leaveDays: 0, leaveBalance: null, latePunchIns: late,
    daysBelowNineHours: 0, approvedCompOff: 0, unresolvedDays: 0, attendanceCompletionPercentage: null,
  });
  const month = (m: string, employees: ReturnType<typeof employee>[]) => ({ month: m, employees }) as any;

  it('flags an issue only when it appears in at least three months', () => {
    const result = recurringIssues([
      month('2026-08', [employee('a', 2), employee('b', 1)]),
      month('2026-09', [employee('a', 1), employee('b', 0)]),
      month('2026-10', [employee('a', 4), employee('b', 3)]),
    ]);
    expect(result.frequentLate.map((p) => p.employee.userId)).toEqual(['a']);
    expect(result.repeatedAbsence).toEqual([]);
  });
});

describe('attendance analytics: roster filters match the server counts', () => {
  const row = (status: string | null, flags: string[] = [], requiresReview = false) => ({
    employee: { id: String(status), name: 'x', email: 'x', employeeId: null, department: null },
    status, evaluationState: status ? 'CALCULATED' : 'NOT_EVALUATED', punchInAt: null, punchOutAt: null,
    workedMinutes: null, breakMinutes: null, exceptionFlags: flags, requiresReview, revision: 0,
  });
  const pick = (rows: ReturnType<typeof row>[], f: RosterFilter) => rows.filter((r) => matchesRosterFilter(r, f));

  it('keeps late arrivals out of Present, as the Present tile does', () => {
    const rows = [row('PRESENT'), row('LATE'), row('LATE_EXEMPTED')];
    expect(pick(rows, 'present')).toHaveLength(1);
    expect(pick(rows, 'late')).toHaveLength(2);
  });

  it('narrows each Needs attention line to its own people', () => {
    const rows = [
      row('PRESENT', ['MISSING_PUNCH_OUT']),
      row('ABSENT', ['NO_ATTENDANCE_EVIDENCE']),
      row('PRESENT', ['LOCATION_OUTSIDE_GEOFENCE']),
      row('HALF_DAY', [], true),
      row(null),
      row('PRESENT'),
    ];
    expect(pick(rows, 'missingPunchOut')).toEqual([rows[0]]);
    expect(pick(rows, 'missingPunch')).toEqual([rows[1]]);
    expect(pick(rows, 'outsideGeofence')).toEqual([rows[2]]);
    expect(pick(rows, 'review')).toEqual([rows[3]]);
    expect(pick(rows, 'noRecord')).toEqual([rows[4]]);
    expect(pick(rows, 'action')).toHaveLength(5);
  });
});

describe('attendance analytics: register requests run two at a time', () => {
  it('never runs more than two at once, runs all twelve, and a failure frees its slot', async () => {
    const run = limitConcurrency(2);
    let active = 0;
    let peak = 0;
    const months = Array.from({ length: 12 }, (_, i) => i);
    const results = await Promise.allSettled(months.map((i) => run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (i === 3) throw new Error('month 3 failed');
      return i;
    })));
    expect(peak).toBe(2);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(11);
    expect(results[3].status).toBe('rejected');
  });
});

describe('attendance analytics: requests nobody needs any more are skipped', () => {
  it('never starts a waiting task whose signal fired, and lets the rest run', async () => {
    const run = limitConcurrency(2);
    const started: number[] = [];
    const stale = new AbortController();
    const task = (i: number) => async () => {
      started.push(i);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return i;
    };
    // Two run now; 2-5 wait. The view is left before they get a turn.
    const old = [0, 1, 2, 3, 4, 5].map((i) => run(task(i), stale.signal));
    await new Promise((resolve) => setTimeout(resolve, 1)); // 0 and 1 are now running
    stale.abort();
    const fresh = [10, 11].map((i) => run(task(i)));
    const oldResults = await Promise.allSettled(old);
    await Promise.all(fresh);
    expect(started.sort((a, b) => a - b)).toEqual([0, 1, 10, 11]);
    expect(oldResults.slice(2).every((r) => r.status === 'rejected')).toBe(true);
  });
});
