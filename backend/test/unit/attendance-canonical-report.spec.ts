import {
  DAILY_COLUMNS,
  SUMMARY_COLUMNS,
  buildDailyRow,
  buildMonthReport,
  buildMonthlySummary,
  deriveDataSource,
  deriveStatus,
  type DayInput,
  type ReportEmployee,
} from '../../src/modules/platform/attendance/canonical/attendance-report';

/**
 * The canonical report contract and the status semantics.
 *
 * Behavioural throughout: every case builds a row and asserts what it says. No
 * assertion matches source text.
 *
 * TIMES ARE ODD ON PURPOSE. 04:11, 13:29, 09:37 -- nothing lands on a half hour
 * or on 540, so a row returning the wrong one of several candidate figures
 * cannot coincidentally match.
 */

const EMP: ReportEmployee = {
  userId: 'u-1',
  name: 'Rahul',
  employeeId: 'TE-014',
  department: 'Engineering',
  designation: 'Software Engineer',
  employeeType: 'Full-time',
};

const fmt = (d: Date) => d.toISOString().slice(11, 16);

const day = (over: Partial<DayInput> = {}): DayInput => ({
  date: '2026-09-14',
  employment: { employedOnDate: true, reason: 'EMPLOYED' },
  workingDay: true,
  inExtract: true,
  official: null,
  rawPunches: [],
  workSessions: [],
  leave: null,
  compOff: false,
  regularization: null,
  requiredMinutes: 540,
  arrivalThreshold: '09:30',
  arrivalGraceMinutes: 0,
  arrivalMinutes: null,
  ...over,
});

const punch = (type: string, hhmm: string) => ({
  type,
  occurredAt: new Date(`2026-09-14T${hhmm}:00.000Z`),
});

const official = (over: any = {}) => ({
  status: 'PRESENT',
  evaluationState: 'CALCULATED',
  punchInAt: new Date('2026-09-14T04:11:00.000Z'),
  punchOutAt: new Date('2026-09-14T13:29:00.000Z'),
  workedMinutes: 486,
  breakMinutes: 36,
  lateMinutes: 0,
  leaveDeducted: 0,
  lwpDeducted: 0,
  exceptionFlags: [],
  regularizationId: null,
  viaManualRecovery: false,
  ...over,
});

const row = (over: Partial<DayInput> = {}) => buildDailyRow(EMP, day(over), fmt);

// ════════════════════════════════════════════════════════════════════════════
describe('the contract', () => {
  it('26. the daily contract is exactly 26 columns in the approved order', () => {
    expect(DAILY_COLUMNS).toHaveLength(26);
    expect(DAILY_COLUMNS[0]).toBe('Employee Name');
    expect(DAILY_COLUMNS[5]).toBe('Date');
    expect(DAILY_COLUMNS[13]).toBe('Total Presence Time');
    expect(DAILY_COLUMNS[17]).toBe('9-Hour Completion / Shortfall');
    expect(DAILY_COLUMNS[25]).toBe('Data Source');
  });

  it('27. the summary contract is exactly 19 columns in the approved order', () => {
    expect(SUMMARY_COLUMNS).toHaveLength(19);
    expect(SUMMARY_COLUMNS[0]).toBe('Employee Name');
    expect(SUMMARY_COLUMNS[5]).toBe('Working Days');
    expect(SUMMARY_COLUMNS[11]).toBe('Days Below 9 Hours');
    expect(SUMMARY_COLUMNS[18]).toBe('Unresolved Days');
  });

  it('exposes no DATABASE keys as visible columns', () => {
    // "Employee ID" is the company's own human identifier and belongs on the
    // sheet. What must never appear is a database key -- a userId, a cuid, a
    // row id -- so the check names those rather than matching "id" loosely,
    // which would reject the legitimate column too.
    for (const header of [...DAILY_COLUMNS, ...SUMMARY_COLUMNS]) {
      expect(header).not.toMatch(/userId|user id|uuid|cuid|_id|\bkey\b|record id|row id/i);
    }
    expect(DAILY_COLUMNS).toContain('Employee ID');

    // And the row carries userId as a field, deliberately outside the contract.
    const r = row();
    expect(r.userId).toBe('u-1');
    expect(DAILY_COLUMNS as readonly string[]).not.toContain('userId');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('presence evidence establishes Present', () => {
  it('1. a complete punch pair is Present with a measured span', () => {
    const r = row({ rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')] });

    expect(r.attendanceStatus).toBe('Present');
    expect(r.present).toBe('Yes');
    expect(r.punchIn).toBe('04:11');
    expect(r.punchOut).toBe('13:29');
    expect(r.totalPresenceTime).toBe('09:18'); // 558 minutes
    expect(r.missingPunch).toBe('—');
  });

  it('2. PUNCH-IN ONLY IS PRESENT, with the missing end named and no span invented', () => {
    const r = row({ rawPunches: [punch('PUNCH_IN', '04:11')] });

    expect(r.attendanceStatus).toBe('Present');
    expect(r.punchIn).toBe('04:11');
    expect(r.punchOut).toBe('—');
    expect(r.missingPunch).toBe('Punch Out');
    // Unresolved, not zero and not guessed.
    expect(r.totalPresenceTime).toBe('—');
    expect(r.raw.presenceMinutes).toBeNull();
    expect(r.remarks).toContain('Presence cannot be calculated');
  });

  it('3. punch-out only is Present, with the missing start named', () => {
    const r = row({ rawPunches: [punch('PUNCH_OUT', '13:29')] });

    expect(r.attendanceStatus).toBe('Present');
    expect(r.punchIn).toBe('—');
    expect(r.punchOut).toBe('13:29');
    expect(r.missingPunch).toBe('Punch In');
    expect(r.totalPresenceTime).toBe('—');
  });

  it('4. A WORKSESSION ALONE IS PRESENT, with worked time but no punches', () => {
    const r = row({
      workSessions: [
        {
          startWorkAt: new Date('2026-09-14T04:30:00.000Z'),
          logoutAt: new Date('2026-09-14T13:00:00.000Z'),
          totalWorkMinutes: 474,
          totalBreakMinutes: 36,
          autoClosed: false,
        },
      ],
    });

    expect(r.attendanceStatus).toBe('Present');
    // The session is not a punch. These columns report what the employee
    // recorded, and they recorded nothing.
    expect(r.punchIn).toBe('—');
    expect(r.punchOut).toBe('—');
    expect(r.totalPresenceTime).toBe('—');
    expect(r.hoursWorked).toBe('07:54'); // 474
    expect(r.dataSource).toBe('WorkSessions');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('an auto-close is not a punch out', () => {
  it('5. A POLICY AUTO-CLOSE NEVER BECOMES THE EMPLOYEE PUNCH OUT', () => {
    const r = row({
      workSessions: [
        {
          startWorkAt: new Date('2026-09-14T04:30:00.000Z'),
          // 20:00 company time. The scheduler closed a session nobody ended.
          logoutAt: new Date('2026-09-14T14:30:00.000Z'),
          totalWorkMinutes: 551,
          totalBreakMinutes: 49,
          autoClosed: true,
        },
      ],
    });

    expect(r.attendanceStatus).toBe('Present');
    expect(r.punchOut).toBe('—');
    expect(r.punchOut).not.toBe('14:30');
    expect(r.totalPresenceTime).toBe('—');
    expect(r.hoursWorked).toBe('09:11'); // 551, which the session does support
    expect(r.remarks).toContain('auto-closed by policy');
  });

  it('completion falls back to worked time and says so when presence is unknown', () => {
    const r = row({
      workSessions: [
        {
          startWorkAt: new Date('2026-09-14T04:30:00.000Z'),
          logoutAt: new Date('2026-09-14T14:30:00.000Z'),
          totalWorkMinutes: 551,
          totalBreakMinutes: 49,
          autoClosed: true,
        },
      ],
    });

    expect(r.completion).toBe('Completed — worked time');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('uncertainty never becomes absence', () => {
  it('6. employed + confirmed working day + no evidence at all -> Absent', () => {
    expect(row().attendanceStatus).toBe('Absent');
    expect(row().absent).toBe('Yes');
  });

  it('7. a weekly off is not Absent', () => {
    expect(row({ workingDay: false }).attendanceStatus).toBe('Weekly Off');
  });

  it('8. AN UNCONFIRMED CALENDAR IS NOT ABSENT', () => {
    expect(row({ workingDay: null }).attendanceStatus).toBe('Calendar not confirmed');
  });

  it('9. before joining is "Not yet joined"', () => {
    const r = row({ employment: { employedOnDate: false, reason: 'BEFORE_JOINING' } });

    expect(r.attendanceStatus).toBe('Not yet joined');
    expect(r.absent).toBe('');
  });

  it('10. after a verified exit is not Absent', () => {
    const r = row({
      employment: { employedOnDate: false, reason: 'AFTER_LAST_WORKING_DATE' },
    });

    expect(r.attendanceStatus).toBe('Not in extract');
    expect(r.absent).toBe('');
  });

  it('11. unknown employment is "Employment not verified", not Absent', () => {
    const r = row({ employment: { employedOnDate: false, reason: 'NO_JOINING_DATE' } });

    expect(r.attendanceStatus).toBe('Employment not verified');
    expect(r.absent).toBe('');
  });

  it('a date outside the reported data is not Absent', () => {
    expect(row({ inExtract: false }).attendanceStatus).toBe('Not in extract');
  });

  it('A MISSING OFFICIAL ROW IS NEVER ABSENCE ON ITS OWN', () => {
    // Evidence exists, nobody evaluated it. That is unresolved, not absent.
    const r = row({ rawPunches: [punch('PUNCH_IN', '04:11')] });

    // The row itself reports that no official record backed it.
    expect(r.dataSource).toBe('Raw punches');
    expect(r.dataSource).not.toBe('Official attendance');
    expect(r.attendanceStatus).toBe('Present');
    expect(r.remarks).toContain('No official attendance record');
    expect(r.raw.unresolved).toBe(true);
  });

  it('work on a non-working day still reads Present', () => {
    const r = row({
      workingDay: false,
      rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')],
    });

    expect(r.attendanceStatus).toBe('Present');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('regularization: a request is not a correction', () => {
  it('12. A PENDING REGULARIZATION DOES NOT ALTER THE FACTS', () => {
    const withPending = row({
      rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')],
      regularization: { status: 'PENDING', invalid: false },
    });
    const without = row({
      rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')],
    });

    expect(withPending.manualCorrection).toBe('Pending — not applied');
    // Every figure identical to the uncorrected day.
    expect(withPending.punchIn).toBe(without.punchIn);
    expect(withPending.punchOut).toBe(without.punchOut);
    expect(withPending.totalPresenceTime).toBe(without.totalPresenceTime);
    expect(withPending.raw.presenceMinutes).toBe(without.raw.presenceMinutes);
  });

  it('13. an invalid correction stays visibly flagged and unapplied', () => {
    const r = row({
      rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')],
      regularization: { status: 'APPROVED', invalid: true },
    });

    expect(r.manualCorrection).toBe('Invalid — not applied');
    expect(r.remarks).toContain('Invalid correction — not applied');
    expect(r.raw.presenceMinutes).toBe(558);
  });

  it('an applied correction is reported as applied', () => {
    const r = row({ official: official({ regularizationId: 'reg-1' }) });

    expect(r.manualCorrection).toBe('Applied');
  });

  it('a manual recovery is distinguished from an ordinary correction', () => {
    const r = row({
      official: official({ regularizationId: 'reg-2', viaManualRecovery: true }),
    });

    expect(r.manualCorrection).toBe('Manual recovery');
    expect(r.remarks).toContain('Manual recovery');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('leave and half days', () => {
  it('14. approved leave shows the type and reads as not-absent', () => {
    const r = row({ leave: { type: 'CASUAL', isHalfDay: false } });

    expect(r.leave).toBe('Yes');
    expect(r.leaveType).toBe('CASUAL');
    expect(r.absent).toBe('');
  });

  it('15. a half day is marked as one', () => {
    const r = row({ leave: { type: 'CASUAL', isHalfDay: true } });

    expect(r.halfDay).toBe('Yes');
  });

  it('a half-day official status also marks it', () => {
    expect(row({ official: official({ status: 'HALF_DAY' }) }).halfDay).toBe('Yes');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('late arrival is independent of status', () => {
  it('16. AN EMPLOYEE CAN BE PRESENT AND LATE AT THE SAME TIME', () => {
    const r = row({
      rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')],
      arrivalMinutes: 9 * 60 + 37,
      arrivalThreshold: '09:30',
    });

    expect(r.attendanceStatus).toBe('Present');
    expect(r.lateArrival).toBe('Late by 00:07');
  });

  it('reports On time rather than a blank when the arrival was punctual', () => {
    const r = row({ arrivalMinutes: 9 * 60 + 20, arrivalThreshold: '09:30' });

    expect(r.lateArrival).toBe('On time');
  });

  it('refuses to claim lateness with no proven threshold', () => {
    const r = row({ arrivalMinutes: 11 * 60, arrivalThreshold: null });

    expect(r.lateArrival).toBe('—');
  });

  it('the same arrival against a later shift is on time', () => {
    const r = row({ arrivalMinutes: 9 * 60 + 37, arrivalThreshold: '10:30' });

    expect(r.lateArrival).toBe('On time');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('presence, worked and break stay separate', () => {
  it('17-19. all three are reported, and none substitutes for another', () => {
    const r = row({
      official: official({ workedMinutes: 120, breakMinutes: 36 }),
    });

    // Punches say 558; worked says 120. Both are reported as given.
    expect(r.totalPresenceTime).toBe('09:18');
    expect(r.hoursWorked).toBe('02:00');
    expect(r.breakTime).toBe('00:36');
    expect(r.raw.presenceMinutes).toBe(558);
    expect(r.raw.workedMinutes).toBe(120);
  });

  it('20. shortfall measured from presence names presence', () => {
    const r = row({
      official: official({
        punchInAt: new Date('2026-09-14T04:11:00.000Z'),
        punchOutAt: new Date('2026-09-14T12:34:00.000Z'), // 503 minutes
      }),
    });

    expect(r.completion).toBe('Short by 00:37 — presence');
  });

  it('22. an unprovable requirement is "Cannot determine", not a pass', () => {
    const r = row({
      requiredMinutes: null,
      rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')],
    });

    expect(r.completion).toBe('Cannot determine');
    expect(r.remarks).toContain('Required minutes unresolved');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('data source is readable, never internal jargon', () => {
  it('names each evidence combination', () => {
    expect(deriveDataSource(day({ official: official() }))).toBe('Official attendance');
    expect(deriveDataSource(day({ rawPunches: [punch('PUNCH_IN', '04:11')] }))).toBe('Raw punches');
    expect(
      deriveDataSource(
        day({
          rawPunches: [punch('PUNCH_IN', '04:11')],
          workSessions: [
            { startWorkAt: new Date(), logoutAt: null, totalWorkMinutes: 0, totalBreakMinutes: 0, autoClosed: false },
          ],
        }),
      ),
    ).toBe('Raw punches + WorkSessions');
    expect(deriveDataSource(day({ leave: { type: 'CASUAL', isHalfDay: false } }))).toBe('Leave');
    expect(deriveDataSource(day({ inExtract: false }))).toBe('Extract cutoff');
    expect(deriveDataSource(day())).toBe('Calendar rule');
  });

  it('never leaks a class, service or file name', () => {
    const sources = new Set<string>();
    for (const d of [
      day({ official: official() }),
      day({ rawPunches: [punch('PUNCH_IN', '04:11')] }),
      day({ leave: { type: 'CASUAL', isHalfDay: false } }),
      day({ inExtract: false }),
      day(),
    ]) {
      sources.add(deriveDataSource(d));
    }
    for (const s of sources) {
      expect(s).not.toMatch(/Service|Repository|\.ts|Prisma|DailyAttendance\b/);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the monthly summary IS the daily rows', () => {
  const employee = (userId: string, name: string): ReportEmployee => ({
    userId,
    name,
    employeeId: `TE-${userId}`,
    department: 'Engineering',
    designation: 'Engineer',
    employeeType: 'Full-time',
  });

  it('25. EVERY SUMMARY FIGURE EQUALS THE AGGREGATION OF ITS DAILY ROWS', () => {
    const days: DayInput[] = [
      day({ date: '2026-09-01', rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')] }),
      day({ date: '2026-09-02', rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')], arrivalMinutes: 9 * 60 + 37 }),
      // THREE late days and ONE absent day, deliberately unequal. Both were 1,
      // so deriving lateDays from the absent count gave the same answer and a
      // mutant swapping them survived.
      day({ date: '2026-09-04', rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')], arrivalMinutes: 9 * 60 + 41 }),
      day({ date: '2026-09-07', rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')], arrivalMinutes: 10 * 60 + 2 }),
      day({ date: '2026-09-03' }), // absent
      day({ date: '2026-09-05', workingDay: false }), // weekly off
      day({ date: '2026-09-06', leave: { type: 'CASUAL', isHalfDay: true } }),
    ];
    const rows = days.map((d) => buildDailyRow(EMP, d, fmt));
    const s = buildMonthlySummary(EMP, rows);

    // Recomputed here from the rows, independently of the implementation.
    expect(s.presentDays).toBe(rows.filter((r) => r.attendanceStatus === 'Present').length);
    expect(s.absentDays).toBe(rows.filter((r) => r.attendanceStatus === 'Absent').length);
    expect(s.halfDays).toBe(rows.filter((r) => r.halfDay === 'Yes').length);
    expect(s.leaveDays).toBe(rows.filter((r) => r.leave === 'Yes').length);
    expect(s.lateDays).toBe(rows.filter((r) => (r.raw.lateMinutes ?? 0) > 0).length);
    // Weekly off excluded from expected days: 6 of the 7 are expected.
    expect(s.workingDays).toBe(6);
    // Unequal on purpose, so neither can stand in for the other.
    expect(s.lateDays).toBe(3);
    expect(s.absentDays).toBe(1);
    expect(s.lateDays).not.toBe(s.absentDays);
  });

  it('24. TWO EMPLOYEES WITH THE SAME NAME DO NOT MERGE', () => {
    const a = employee('u-a', 'Rahul Sharma');
    const b = employee('u-b', 'Rahul Sharma');

    const daysByUser = new Map<string, DayInput[]>([
      ['u-a', [day({ date: '2026-09-01', rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')] })]],
      ['u-b', [day({ date: '2026-09-01' })]], // absent
    ]);

    const report = buildMonthReport({
      month: '2026-09',
      generatedAt: new Date('2026-10-01T00:00:00.000Z'),
      employees: [a, b],
      daysByUser,
      lateCutoff: { clock: '10:30', source: 'SYSTEM_FALLBACK' },
      timeFormatter: fmt,
    });

    expect(report.summaryRows).toHaveLength(2);
    const byId = new Map(report.summaryRows.map((s) => [s.userId, s]));
    expect(byId.get('u-a')!.presentDays).toBe(1);
    expect(byId.get('u-a')!.absentDays).toBe(0);
    expect(byId.get('u-b')!.presentDays).toBe(0);
    expect(byId.get('u-b')!.absentDays).toBe(1);
  });

  it('counts an unevaluated day as unresolved, not as present or absent', () => {
    const rows = [buildDailyRow(EMP, day({ rawPunches: [punch('PUNCH_IN', '04:11')] }), fmt)];
    const s = buildMonthlySummary(EMP, rows);

    expect(s.unresolvedDays).toBe(1);
    expect(s.absentDays).toBe(0);
  });

  it('sums hours from the daily minutes rather than recomputing them', () => {
    const rows = [
      buildDailyRow(EMP, day({ date: '2026-09-01', official: official({ workedMinutes: 480, breakMinutes: 60 }) }), fmt),
      buildDailyRow(EMP, day({ date: '2026-09-02', official: official({ workedMinutes: 540, breakMinutes: 30 }) }), fmt),
    ];
    const s = buildMonthlySummary(EMP, rows);

    expect(s.totalWorkHours).toBe(17); // 1020 minutes
    expect(s.totalBreakHours).toBe(1.5); // 90 minutes
    // Presence: two 558-minute days = 1116 = 18.6h
    expect(s.totalPresenceHours).toBe(18.6);
  });

  it('the report carries both datasets and honest metadata', () => {
    const report = buildMonthReport({
      month: '2026-09',
      generatedAt: new Date('2026-10-01T00:00:00.000Z'),
      employees: [EMP],
      daysByUser: new Map([['u-1', [day({ rawPunches: [punch('PUNCH_IN', '04:11')] })]]]),
      lateCutoff: { clock: '10:30', source: 'SYSTEM_FALLBACK' },
      timeFormatter: fmt,
    });

    expect(report.dailyRows).toHaveLength(1);
    expect(report.summaryRows).toHaveLength(1);
    expect(report.metadata.employees).toBe(1);
    expect(report.metadata.days).toBe(1);
    expect(report.metadata.unresolvedDays).toBe(1);
    expect(report.metadata.employeesWithUnresolved).toBe(1);
  });
});
