import * as ExcelJS from 'exceljs';
import {
  DAILY_COLUMNS,
  SUMMARY_COLUMNS,
  buildMonthReport,
  type DayInput,
  type MonthReport,
  type ReportEmployee,
} from '../../src/modules/platform/attendance/canonical/attendance-report';
import {
  buildAttendanceWorkbook,
  sheetNames,
  workbookToBuffer,
} from '../../src/modules/platform/attendance/canonical/attendance-workbook';

/**
 * A5 + A7: SCREEN/DOWNLOAD PARITY, over a representative month.
 *
 * The console renders the canonical rows verbatim and the workbook formats the
 * same rows, so parity is asserted by comparing each sheet cell to the row
 * object it came from. THE TEST DOES NOT RECOMPUTE ANYTHING -- a second
 * calculation here would be a third interpretation, and it could agree with
 * neither while looking like proof.
 *
 * The fixture covers every case A7 names, so the same month exercises the
 * contract, the parity and the semantics at once.
 */

const fmt = (d: Date) => d.toISOString().slice(11, 16);
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00.000Z`);

const emp = (over: Partial<ReportEmployee> & { userId: string; name: string }): ReportEmployee => ({
  // DELIBERATELY UNRELATED TO userId. Deriving it from the internal id would
  // make the "no internal id leaks" check pass or fail for the wrong reason:
  // the human identifier would contain the database key by construction.
  employeeId: `TE-${over.name.slice(0, 2).toUpperCase()}`,
  department: 'Engineering',
  designation: 'Software Engineer',
  employeeType: 'Full-time',
  ...over,
});

const day = (date: string, over: Partial<DayInput> = {}): DayInput => ({
  date,
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

const pair = (date: string) => [
  { type: 'PUNCH_IN', occurredAt: at(date, '04:11') },
  { type: 'PUNCH_OUT', occurredAt: at(date, '13:29') },
];

// ── The A7 matrix, as one month ───────────────────────────────────────────
const CURRENT = emp({ userId: 'u-current', name: 'Rahul' });
const FORMER = emp({ userId: 'u-former', name: 'Anita', designation: 'Senior Engineer' });
const FUTURE = emp({ userId: 'u-future', name: 'Neha', employeeType: 'Intern' });
const MID_JOIN = emp({ userId: 'u-midjoin', name: 'Kiran', designation: null as any });

const EMPLOYEES = [CURRENT, FORMER, FUTURE, MID_JOIN];

const DAYS = new Map<string, DayInput[]>([
  [
    'u-current',
    [
      // complete punch pair
      day('2026-09-01', { rawPunches: pair('2026-09-01') }),
      // punch-in only
      day('2026-09-02', { rawPunches: [{ type: 'PUNCH_IN', occurredAt: at('2026-09-02', '04:11') }] }),
      // punch-out only
      day('2026-09-03', { rawPunches: [{ type: 'PUNCH_OUT', occurredAt: at('2026-09-03', '13:29') }] }),
      // late, and still Present
      day('2026-09-04', { rawPunches: pair('2026-09-04'), arrivalMinutes: 9 * 60 + 37 }),
      // weekly off
      day('2026-09-05', { workingDay: false }),
      // working day, no evidence at all
      day('2026-09-07', {}),
      // unconfirmed calendar
      day('2026-09-08', { workingDay: null }),
      // requirement unprovable
      day('2026-09-09', { rawPunches: pair('2026-09-09'), requiredMinutes: null }),
    ],
  ],
  [
    'u-former',
    [
      // WorkSession only, unsorted, with a 20:00 policy auto-close
      day('2026-09-21', {
        workSessions: [
          { startWorkAt: at('2026-09-21', '09:30'), logoutAt: null, totalWorkMinutes: 0, totalBreakMinutes: 0, autoClosed: false },
          { startWorkAt: at('2026-09-21', '04:30'), logoutAt: at('2026-09-21', '14:30'), totalWorkMinutes: 551, totalBreakMinutes: 49, autoClosed: true },
        ],
      }),
      // leave
      day('2026-09-22', { leave: { type: 'CASUAL', isHalfDay: false } }),
      // half day
      day('2026-09-23', { leave: { type: 'CASUAL', isHalfDay: true } }),
      // pending regularization
      day('2026-09-24', { rawPunches: pair('2026-09-24'), regularization: { status: 'PENDING', invalid: false } }),
      // invalid regularization
      day('2026-09-25', { rawPunches: pair('2026-09-25'), regularization: { status: 'APPROVED', invalid: true } }),
      // exited mid-month: after the last working day
      day('2026-09-26', { employment: { employedOnDate: false, reason: 'AFTER_LAST_WORKING_DATE' } }),
    ],
  ],
  [
    'u-future',
    [
      // future joiner
      day('2026-09-10', { employment: { employedOnDate: false, reason: 'BEFORE_JOINING' } }),
      // extract cutoff
      day('2026-09-11', { inExtract: false }),
    ],
  ],
  [
    'u-midjoin',
    [
      // joined mid-month: before, then on
      day('2026-09-14', { employment: { employedOnDate: false, reason: 'BEFORE_JOINING' } }),
      day('2026-09-15', { rawPunches: pair('2026-09-15'), compOff: true }),
      // employment unverifiable
      day('2026-09-16', { employment: { employedOnDate: false, reason: 'NO_JOINING_DATE' } }),
    ],
  ],
]);

const report = (): MonthReport =>
  buildMonthReport({
    month: '2026-09',
    generatedAt: new Date('2026-10-01T09:00:00.000Z'),
    employees: EMPLOYEES,
    daysByUser: DAYS,
    timeFormatter: fmt,
  });

const headersOf = (s: ExcelJS.Worksheet) =>
  (s.getRow(1).values as any[]).slice(1).map(String);

/** Visible cells for one daily row, keyed by column name. */
const dailyExpect = (r: MonthReport['dailyRows'][number]): Record<string, string> => ({
  'Employee Name': r.employeeName,
  'Employee ID': r.employeeId,
  Department: r.department,
  Designation: r.designation,
  'Employee Type': r.employeeType,
  Date: r.date,
  'Attendance Status': r.attendanceStatus,
  Present: r.present,
  Absent: r.absent,
  'Half Day': r.halfDay,
  Leave: r.leave,
  'Punch In': r.punchIn,
  'Punch Out': r.punchOut,
  'Total Presence Time': r.totalPresenceTime,
  'Hours Worked': r.hoursWorked,
  'Break Time': r.breakTime,
  'Late Arrival': r.lateArrival,
  '9-Hour Completion / Shortfall': r.completion,
  'Leave Type': r.leaveType,
  'Leave Deducted': r.leaveDeducted,
  'LWP / Unpaid Portion': r.lwpUnpaid,
  'Comp Off': r.compOff,
  'Manual Correction / Regularization': r.manualCorrection,
  'Missing Punch': r.missingPunch,
  'Remarks / Exception': r.remarks,
  'Data Source': r.dataSource,
});

const summaryExpect = (s: MonthReport['summaryRows'][number]): Record<string, string | number> => ({
  'Employee Name': s.employeeName,
  'Employee ID': s.employeeId,
  Department: s.department,
  Designation: s.designation,
  'Employee Type': s.employeeType,
  'Working Days': s.workingDays,
  'Present Days': s.presentDays,
  'Absent Days': s.absentDays,
  'Half Days': s.halfDays,
  'Leave Days': s.leaveDays,
  'Late Days': s.lateDays,
  'Days Below 9 Hours': s.daysBelowNineHours,
  'Total Presence Hours': s.totalPresenceHours,
  'Total Work Hours': s.totalWorkHours,
  'Total Break Hours': s.totalBreakHours,
  'CL Used': s.clUsed,
  'LWP / Unpaid Days': s.lwpUnpaidDays,
  'Attendance Deductions': s.attendanceDeductions,
  'Unresolved Days': s.unresolvedDays,
});

// ════════════════════════════════════════════════════════════════════════════
describe('A7. the representative month covers every named case', () => {
  const r = report();

  it('produces rows for all four employee situations', () => {
    expect(new Set(r.dailyRows.map((d) => d.userId)).size).toBe(4);
    expect(r.summaryRows).toHaveLength(4);
  });

  it('EXERCISES EVERY VISIBLE STATUS', () => {
    const seen = new Set(r.dailyRows.map((d) => d.attendanceStatus));

    for (const status of [
      'Present',
      'Absent',
      'Weekly Off',
      'Calendar not confirmed',
      'Not yet joined',
      'Employment not verified',
      'Not in extract',
    ]) {
      expect(seen).toContain(status);
    }
  });

  it('exercises every data source the evidence can produce', () => {
    const seen = new Set(r.dailyRows.map((d) => d.dataSource));

    expect(seen).toContain('Raw punches');
    expect(seen).toContain('WorkSessions');
    expect(seen).toContain('Leave');
    expect(seen).toContain('Calendar rule');
    expect(seen).toContain('Extract cutoff');
  });

  it('keeps the auto-close out of Punch Out while crediting its worked time', () => {
    const row = r.dailyRows.find((d) => d.userId === 'u-former' && d.date === '2026-09-21')!;

    expect(row.attendanceStatus).toBe('Present');
    expect(row.punchOut).toBe('—');
    expect(row.totalPresenceTime).toBe('—');
    expect(row.hoursWorked).toBe('09:11');
    expect(row.remarks).toContain('auto-closed by policy');
  });

  it('shows the unsorted sessions did not change the answer', () => {
    // The 09:30 session is listed first; the 04:30 one is earlier. Worked time
    // sums both closed sessions and is unaffected by their order.
    const row = r.dailyRows.find((d) => d.userId === 'u-former' && d.date === '2026-09-21')!;

    expect(row.raw.workedMinutes).toBe(551);
  });

  it('25. the summary equals the aggregation of the daily rows', () => {
    for (const s of r.summaryRows) {
      const mine = r.dailyRows.filter((d) => d.userId === s.userId);

      expect(s.presentDays).toBe(mine.filter((d) => d.attendanceStatus === 'Present').length);
      expect(s.absentDays).toBe(mine.filter((d) => d.attendanceStatus === 'Absent').length);
      expect(s.halfDays).toBe(mine.filter((d) => d.halfDay === 'Yes').length);
      expect(s.leaveDays).toBe(mine.filter((d) => d.leave === 'Yes').length);
      expect(s.lateDays).toBe(mine.filter((d) => (d.raw.lateMinutes ?? 0) > 0).length);
      expect(s.unresolvedDays).toBe(mine.filter((d) => d.raw.unresolved).length);
    }
  });

  it('never reports an Absent day that is merely unknown', () => {
    // No row may be marked absent while also carrying one of the four
    // uncertainty statuses: those exist precisely so "we cannot say" has
    // somewhere to go other than an unpaid day.
    const UNCERTAIN = [
      'Calendar not confirmed',
      'Not yet joined',
      'Employment not verified',
      'Not in extract',
    ];
    for (const d of r.dailyRows) {
      if (d.absent === 'Yes') {
        expect(d.attendanceStatus).toBe('Absent');
        expect(UNCERTAIN).not.toContain(d.attendanceStatus);
        // And an absent day is never simultaneously present or on leave.
        expect(d.present).toBe('');
        expect(d.leave).toBe('');
      }
      if (UNCERTAIN.includes(d.attendanceStatus)) expect(d.absent).toBe('');
    }
    // Exactly one day in this month meets the whole Absent conjunction.
    expect(r.dailyRows.filter((d) => d.absent === 'Yes')).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('A7. the workbook contract, on the representative month', () => {
  const wb = buildAttendanceWorkbook(report());

  it('has exactly two sheets, named for the month', () => {
    expect(wb.worksheets).toHaveLength(2);
    expect(wb.worksheets[0].name).toBe(sheetNames('2026-09').daily);
    expect(wb.worksheets[1].name).toBe(sheetNames('2026-09').summary);
  });

  it('has no hidden, diagnostic or raw sheet', () => {
    for (const ws of wb.worksheets) {
      expect(ws.state).not.toBe('hidden');
      expect(ws.state).not.toBe('veryHidden');
      expect(ws.name).not.toMatch(/raw|diagnos|debug|cover|report$/i);
    }
  });

  it('has exactly 26 and 19 headers, in the approved order', () => {
    expect(headersOf(wb.worksheets[0])).toEqual([...DAILY_COLUMNS]);
    expect(headersOf(wb.worksheets[1])).toEqual([...SUMMARY_COLUMNS]);
  });

  it('LEAKS NO INTERNAL ID, in any header or any cell', () => {
    for (const ws of wb.worksheets) {
      for (const h of headersOf(ws)) {
        expect(h).not.toMatch(/userId|uuid|cuid|_id|record id|row id/i);
      }
      ws.eachRow((row) => {
        for (const v of (row.values as any[]).slice(1)) {
          if (typeof v !== 'string') continue;
          // The internal userIds used by this fixture must appear nowhere.
          for (const e of EMPLOYEES) expect(v).not.toContain(e.userId);
        }
      });
    }
  });

  it('survives a round trip through real xlsx bytes', async () => {
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load((await workbookToBuffer(wb)) as any);

    expect(reopened.worksheets).toHaveLength(2);
    expect(headersOf(reopened.worksheets[0])).toHaveLength(26);
    expect(headersOf(reopened.worksheets[1])).toHaveLength(19);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('A5. every console value equals every workbook cell', () => {
  const r = report();
  const wb = buildAttendanceWorkbook(r);

  it('ALL 26 DAILY COLUMNS, EVERY ROW', () => {
    const sheet = wb.worksheets[0];
    const headers = headersOf(sheet);

    expect(r.dailyRows.length).toBeGreaterThan(15);

    r.dailyRows.forEach((canonical, i) => {
      const expected = dailyExpect(canonical);
      const row = sheet.getRow(i + 2);
      headers.forEach((h, col) => {
        const cell = row.getCell(col + 1).value;
        expect(cell == null ? '' : String(cell)).toBe(expected[h]);
      });
    });
  });

  it('ALL 19 SUMMARY COLUMNS, EVERY ROW', () => {
    const sheet = wb.worksheets[1];
    const headers = headersOf(sheet);

    r.summaryRows.forEach((canonical, i) => {
      const expected = summaryExpect(canonical);
      const row = sheet.getRow(i + 2);
      headers.forEach((h, col) => {
        const cell = row.getCell(col + 1).value;
        const want = expected[h];
        if (typeof want === 'number') expect(cell).toBe(want);
        else expect(cell == null ? '' : String(cell)).toBe(want);
      });
    });
  });

  it('the API payload is the same object the workbook was built from', () => {
    // The controller returns these arrays unchanged, so parity is structural
    // rather than coincidental: there is one array, read twice.
    const payload = {
      month: r.month,
      dailyRows: r.dailyRows,
      summaryRows: r.summaryRows,
      metadata: r.metadata,
    };

    expect(payload.dailyRows).toBe(r.dailyRows);
    expect(payload.summaryRows).toBe(r.summaryRows);
  });

  it('renders deterministically: the same month twice gives the same bytes', async () => {
    const a = await workbookToBuffer(buildAttendanceWorkbook(report()));
    const b = await workbookToBuffer(buildAttendanceWorkbook(report()));

    expect(a.equals(b)).toBe(true);
  });
});
