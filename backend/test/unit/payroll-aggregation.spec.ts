import {
  monthTotals,
  presenceMinutes,
  sourceLabel,
  summarise,
  toRegisterRow,
  type DayFacts,
  type EmployeeMeta,
} from '../../src/modules/platform/attendance/reports/payroll-aggregation';
import { reportFingerprint } from '../../src/modules/platform/attendance/reports/payroll-workbook';

// These numbers reach Finance and influence salary, so the arithmetic is tested
// without a database. Two rules matter more than the rest:
//
//   presence is punch out minus punch in, never Workday time
//   an unjudged day is counted as unresolved, never as present or absent

const EMPLOYEE: EmployeeMeta = {
  id: 'emp-1',
  employeeId: 'TE-014',
  name: 'Rahul',
  department: 'Engineering',
};

const day = (over: Partial<DayFacts> = {}): DayFacts => ({
  userId: 'emp-1',
  date: '2026-08-03',
  status: 'PRESENT',
  evaluationState: 'CALCULATED',
  punchInAt: '2026-08-03T04:00:00.000Z',
  punchOutAt: '2026-08-03T13:00:00.000Z',
  punchInSource: 'WEB',
  punchOutSource: 'WEB',
  workedMinutes: 486,
  breakMinutes: 36,
  lateMinutes: 0,
  leaveDeducted: 0,
  lwpDeducted: 0,
  leaveType: null,
  exceptionFlags: [],
  regularizationId: null,
  viaManualRecovery: false,
  sessionSpanMinutes: 522,
  ...over,
});

describe('attendance presence is punch out minus punch in', () => {
  it('measures the punch pair, not the work', () => {
    // 09:30 to 18:30 IST = 540 minutes, while worked is 486 and span 522.
    // All three appear in the report and none substitutes for another.
    expect(presenceMinutes(day())).toBe(540);
  });

  it('is null when either punch is missing', () => {
    expect(presenceMinutes(day({ punchOutAt: null }))).toBeNull();
    expect(presenceMinutes(day({ punchInAt: null }))).toBeNull();
  });

  it('never falls back to worked minutes or session span', () => {
    const incomplete = day({ punchOutAt: null, workedMinutes: 600, sessionSpanMinutes: 620 });

    expect(presenceMinutes(incomplete)).toBeNull();
  });

  it('reports all three separately in the register row', () => {
    const row = toRegisterRow(EMPLOYEE, day(), 540);

    expect(row.presenceMinutes).toBe(540);
    expect(row.workedMinutes).toBe(486);
    expect(row.workdaySpanMinutes).toBe(522);
    expect(row.requiredMinutes).toBe(540);
  });

  it('says so plainly when presence cannot be calculated', () => {
    const row = toRegisterRow(EMPLOYEE, day({ punchOutAt: null }), 540);

    expect(row.presenceMinutes).toBeNull();
    expect(row.remarks).toMatch(/Presence cannot be calculated/);
  });

  it('does not add that remark to a non-working day', () => {
    // A holiday has no punches and needs no explanation.
    const row = toRegisterRow(EMPLOYEE, day({ status: 'HOLIDAY', punchInAt: null, punchOutAt: null }), 540);

    expect(row.remarks).not.toMatch(/Presence cannot be calculated/);
  });
});

describe('punch source is legible to Finance', () => {
  it.each([
    ['WEB', 'Web'],
    ['PWA', 'Web'],
    ['MOBILE', 'Phone'],
    ['MANUAL_APPROVED', 'Manual'],
    [null, '—'],
    ['SOMETHING_NEW', '—'],
  ])('%s reads as %s', (source, expected) => {
    expect(sourceLabel(source as any)).toBe(expected);
  });

  it('distinguishes the three routes on one row', () => {
    const row = toRegisterRow(
      EMPLOYEE,
      day({ punchInSource: 'MOBILE', punchOutSource: 'MANUAL_APPROVED' }),
      540,
    );

    expect(row.punchInSource).toBe('Phone');
    expect(row.punchOutSource).toBe('Manual');
  });
});

describe('unresolved days are counted, never absorbed', () => {
  it('counts a needs-review day as unresolved', () => {
    const s = summarise(EMPLOYEE, [day({ evaluationState: 'NEEDS_REVIEW' })]);

    expect(s.unresolvedDays).toBe(1);
    expect(s.needsReview).toBe(1);
  });

  it('counts a never-evaluated day as unresolved', () => {
    const s = summarise(EMPLOYEE, [day({ evaluationState: 'NOT_EVALUATED', status: 'ABSENT' })]);

    expect(s.unresolvedDays).toBe(1);
  });

  it('does not silently make an unjudged day absent or present', () => {
    // Rounding it either way is how an unreviewed exception becomes a pay cut.
    const days = [
      day({ date: '2026-08-03', evaluationState: 'NEEDS_REVIEW', status: 'MISSING_PUNCH' }),
      day({ date: '2026-08-04' }),
    ];
    const s = summarise(EMPLOYEE, days);

    expect(s.present).toBe(1);
    expect(s.absent).toBe(0);
    expect(s.unresolvedDays).toBe(1);
  });
});

describe('the summary counts', () => {
  const month = [
    day({ date: '2026-08-03' }),
    day({ date: '2026-08-04', status: 'LATE', lateMinutes: 12 }),
    day({ date: '2026-08-05', status: 'ABSENT', punchInAt: null, punchOutAt: null }),
    day({ date: '2026-08-06', status: 'LEAVE', leaveType: 'CASUAL', punchInAt: null, punchOutAt: null }),
    day({ date: '2026-08-07', status: 'HALF_DAY', leaveType: 'EMERGENCY' }),
    day({ date: '2026-08-08', status: 'WEEKLY_OFF', punchInAt: null, punchOutAt: null }),
    day({ date: '2026-08-15', status: 'HOLIDAY', punchInAt: null, punchOutAt: null }),
    day({ date: '2026-08-17', status: 'LEAVE', leaveType: 'COMP_OFF', punchInAt: null, punchOutAt: null }),
    day({ date: '2026-08-18', regularizationId: 'reg-1' }),
    day({ date: '2026-08-19', regularizationId: 'reg-2', viaManualRecovery: true }),
  ];
  const s = summarise(EMPLOYEE, month);

  it('identifies the employee for payroll', () => {
    expect(s.employeeId).toBe('TE-014');
    expect(s.department).toBe('Engineering');
  });

  it('counts present including late', () => {
    // 03 present, 04 late, 18 and 19 present after correction. Late counts as
    // present; lateness is reported separately, not by marking someone absent.
    expect(s.present).toBe(4);
    expect(s.lateDays).toBe(1);
  });

  it('breaks leave down by type', () => {
    expect(s.casualLeave).toBe(1);
    expect(s.compOff).toBe(1);
    // A half day consumes half an entitlement day.
    expect(s.emergencyLeave).toBe(0.5);
  });

  it('excludes non-working days from working days', () => {
    expect(s.weeklyOffs).toBe(1);
    expect(s.holidays).toBe(1);
    expect(s.workingDays).toBe(8);
  });

  it('separates a correction from an outage recovery', () => {
    // Both are corrections; only one was an outage, and Finance may treat them
    // differently.
    expect(s.regularizedDays).toBe(2);
    expect(s.manualRecoveryDays).toBe(1);
  });

  it('falls back to the internal id when no employee number exists', () => {
    expect(summarise({ ...EMPLOYEE, employeeId: null }, [day()]).employeeId).toBe('emp-1');
  });
});

describe('month totals tell HR whether the month is ready', () => {
  const a = summarise(EMPLOYEE, [day(), day({ date: '2026-08-04', evaluationState: 'NEEDS_REVIEW' })]);
  const b = summarise({ ...EMPLOYEE, id: 'emp-2', name: 'Sara' }, [day()]);

  it('counts people, not only days', () => {
    // One unreviewed day belongs to a real person whose pay it affects.
    const t = monthTotals([a, b], []);

    expect(t.employees).toBe(2);
    expect(t.unresolvedDays).toBe(1);
    expect(t.employeesWithUnresolved).toBe(1);
  });

  it('reports a clean month as clean', () => {
    expect(monthTotals([b], []).employeesWithUnresolved).toBe(0);
  });
});

describe('no pay is calculated here', () => {
  it('exposes no deduction, salary or amount field', () => {
    // Attendance supplies facts; Finance applies the company's payroll rules.
    const s = summarise(EMPLOYEE, [day()]);
    const row = toRegisterRow(EMPLOYEE, day(), 540);

    for (const key of [...Object.keys(s), ...Object.keys(row)]) {
      expect(key).not.toMatch(/salary|deduct|amount|pay(able)?$|wage/i);
    }
  });
});

describe('the report fingerprint identifies the data, not the file', () => {
  // An XLSX is a ZIP and its entry headers carry clock timestamps, so two
  // renders of identical data differ by ~36 bytes. Hashing the FILE made the
  // finalize/send comparison fail intermittently and report "attendance has
  // changed" when only the clock had. That surfaced as a flaky test before it
  // could surface as a month close that refuses to deliver.
  const summaries = [summarise(EMPLOYEE, [day()])];
  const register = [toRegisterRow(EMPLOYEE, day(), 540)];
  const fp = () => reportFingerprint({ month: '2026-08', summaries, register });

  it('is identical for identical data', () => {
    expect(fp()).toBe(fp());
  });

  it('does not read the clock', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../src/modules/platform/attendance/reports/payroll-workbook.ts',
      ),
      'utf8',
    );
    const fn = src.slice(src.indexOf('export function reportFingerprint'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));

    expect(body).not.toMatch(/new Date\(\)|Date\.now\(\)/);
  });

  it('changes when the attendance changes', () => {
    const other = [summarise(EMPLOYEE, [day({ status: 'ABSENT' })])];

    expect(reportFingerprint({ month: '2026-08', summaries: other, register })).not.toBe(fp());
  });

  it('changes when the month changes', () => {
    expect(reportFingerprint({ month: '2026-09', summaries, register })).not.toBe(fp());
  });

  it('changes when a single register cell changes', () => {
    const other = [{ ...register[0], punchOutSource: 'Manual' as const }];

    expect(reportFingerprint({ month: '2026-08', summaries, register: other })).not.toBe(fp());
  });

  it('does not depend on the declaration order of the row fields', () => {
    // Otherwise reordering an interface silently invalidates every stored
    // fingerprint and every finalized month refuses to send.
    const reordered = [
      Object.fromEntries(Object.entries(summaries[0]).reverse()) as typeof summaries[0],
    ];

    expect(reportFingerprint({ month: '2026-08', summaries: reordered, register })).toBe(fp());
  });
});
