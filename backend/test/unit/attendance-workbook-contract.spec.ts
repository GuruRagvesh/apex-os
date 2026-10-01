import * as ExcelJS from 'exceljs';
import {
  DAILY_COLUMNS,
  SUMMARY_COLUMNS,
  buildMonthReport,
  type DayInput,
  type ReportEmployee,
} from '../../src/modules/platform/attendance/canonical/attendance-report';
import {
  attendanceWorkbookFilename,
  buildAttendanceWorkbook,
  monthLabel,
  sheetNames,
  workbookToBuffer,
} from '../../src/modules/platform/attendance/canonical/attendance-workbook';

/**
 * THE WORKBOOK CONTRACT, asserted against a real rendered workbook.
 *
 * Two sheets, 26 and 19 columns in the approved order, and every value equal to
 * the canonical row it came from. The last part is the point: the workbook must
 * FORMAT the canonical dataset, never re-derive it, so these tests compare the
 * sheet cell by cell against the row object rather than against a second
 * expectation written by hand.
 */

const EMP: ReportEmployee = {
  userId: 'u-1',
  name: 'Rahul',
  employeeId: 'TE-014',
  department: 'Engineering',
  designation: 'Software Engineer',
  employeeType: 'Full-time',
};

const SECOND: ReportEmployee = {
  userId: 'u-2',
  name: 'Anita',
  employeeId: 'TE-022',
  department: 'Operations',
  designation: 'Analyst',
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

/** A month exercising every interesting row shape. */
function report() {
  return buildMonthReport({
    month: '2026-09',
    generatedAt: new Date('2026-10-01T09:00:00.000Z'),
    employees: [EMP, SECOND],
    daysByUser: new Map<string, DayInput[]>([
      [
        'u-1',
        [
          day({ date: '2026-09-01', rawPunches: [punch('PUNCH_IN', '04:11'), punch('PUNCH_OUT', '13:29')] }),
          day({ date: '2026-09-02', rawPunches: [punch('PUNCH_IN', '04:11')], arrivalMinutes: 9 * 60 + 37 }),
          day({ date: '2026-09-03' }), // absent
          day({ date: '2026-09-05', workingDay: false }), // weekly off
        ],
      ],
      [
        'u-2',
        [
          day({ date: '2026-09-01', leave: { type: 'CASUAL', isHalfDay: true } }),
          day({
            date: '2026-09-02',
            workSessions: [
              {
                startWorkAt: new Date('2026-09-02T04:30:00.000Z'),
                logoutAt: new Date('2026-09-02T14:30:00.000Z'),
                totalWorkMinutes: 551,
                totalBreakMinutes: 49,
                autoClosed: true,
              },
            ],
          }),
        ],
      ],
    ]),
    lateCutoff: { clock: '10:30', source: 'SYSTEM_FALLBACK' },
    timeFormatter: fmt,
  });
}

const headersOf = (sheet: ExcelJS.Worksheet): string[] =>
  (sheet.getRow(1).values as any[]).slice(1).map((v) => String(v));

// ════════════════════════════════════════════════════════════════════════════
describe('the workbook has exactly two sheets', () => {
  it('26. TWO WORKSHEETS AND NO MORE', () => {
    const wb = buildAttendanceWorkbook(report());

    expect(wb.worksheets).toHaveLength(2);
  });

  it('names them for the month and the summary', () => {
    const wb = buildAttendanceWorkbook(report());

    expect(wb.worksheets[0].name).toBe('September 2026 Daily Attendance');
    expect(wb.worksheets[1].name).toBe('Employee Monthly Summary');
    expect(sheetNames('2026-09').daily).toBe('September 2026 Daily Attendance');
    expect(monthLabel('2026-02')).toBe('February 2026');
  });

  it('has NO cover, diagnostics, raw or hidden sheet', () => {
    const wb = buildAttendanceWorkbook(report());

    for (const ws of wb.worksheets) {
      expect(ws.state).not.toBe('hidden');
      expect(ws.state).not.toBe('veryHidden');
      expect(ws.name).not.toMatch(/report|cover|raw|diagnos|debug|exception|payroll summary/i);
    }
    // The previous two builders produced Report, Payroll Summary, Daily
    // Register and Monthly Register between them. None may survive.
    const names = wb.worksheets.map((w) => w.name);
    expect(names).not.toContain('Report');
    expect(names).not.toContain('Payroll Summary');
    expect(names).not.toContain('Daily Register');
    expect(names).not.toContain('Monthly Register');
  });

  it('survives a round trip through real xlsx bytes', async () => {
    const buffer = await workbookToBuffer(buildAttendanceWorkbook(report()));
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer as any);

    expect(reopened.worksheets).toHaveLength(2);
    expect(headersOf(reopened.worksheets[0])).toHaveLength(26);
  });

  it('names the file for the month', () => {
    expect(attendanceWorkbookFilename('2026-09')).toBe('Apex_OS_Attendance_2026-09.xlsx');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the column contracts are exact', () => {
  it('27. THE DAILY SHEET IS 26 COLUMNS IN THE APPROVED ORDER', () => {
    const wb = buildAttendanceWorkbook(report());
    const headers = headersOf(wb.worksheets[0]);

    expect(headers).toHaveLength(26);
    expect(headers).toEqual([...DAILY_COLUMNS]);
  });

  it('28. THE SUMMARY SHEET IS 19 COLUMNS IN THE APPROVED ORDER', () => {
    const wb = buildAttendanceWorkbook(report());
    const headers = headersOf(wb.worksheets[1]);

    expect(headers).toHaveLength(19);
    expect(headers).toEqual([...SUMMARY_COLUMNS]);
  });

  it('exposes no database key as a header', () => {
    const wb = buildAttendanceWorkbook(report());

    for (const ws of wb.worksheets) {
      for (const h of headersOf(ws)) {
        expect(h).not.toMatch(/userId|uuid|cuid|_id|record id|row id/i);
      }
    }
  });

  it('writes one row per canonical row, and no more', () => {
    const r = report();
    const wb = buildAttendanceWorkbook(r);

    // rowCount includes the header.
    expect(wb.worksheets[0].rowCount).toBe(r.dailyRows.length + 1);
    expect(wb.worksheets[1].rowCount).toBe(r.summaryRows.length + 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('29. the workbook FORMATS the canonical rows, it does not re-derive them', () => {
  it('every daily cell equals the canonical row value', () => {
    const r = report();
    const wb = buildAttendanceWorkbook(r);
    const sheet = wb.worksheets[0];
    const headers = headersOf(sheet);

    // The mapping from a canonical row to its expected visible cells, written
    // once here so the comparison is against the ROW rather than against a
    // hand-written table that could drift from it.
    const expectedFor = (row: (typeof r.dailyRows)[number]): Record<string, string> => ({
      'Employee Name': row.employeeName,
      'Employee ID': row.employeeId,
      Department: row.department,
      Designation: row.designation,
      'Employee Type': row.employeeType,
      Date: row.date,
      'Attendance Status': row.attendanceStatus,
      Present: row.present,
      Absent: row.absent,
      'Half Day': row.halfDay,
      Leave: row.leave,
      'Punch In': row.punchIn,
      'Punch Out': row.punchOut,
      'Total Presence Time': row.totalPresenceTime,
      'Hours Worked': row.hoursWorked,
      'Break Time': row.breakTime,
      'Late Arrival': row.lateArrival,
      '9-Hour Completion / Shortfall': row.completion,
      'Leave Type': row.leaveType,
      'Leave Deducted': row.leaveDeducted,
      'LWP / Unpaid Portion': row.lwpUnpaid,
      'Comp Off': row.compOff,
      'Manual Correction / Regularization': row.manualCorrection,
      'Missing Punch': row.missingPunch,
      'Remarks / Exception': row.remarks,
      'Data Source': row.dataSource,
    });

    r.dailyRows.forEach((canonical, i) => {
      const sheetRow = sheet.getRow(i + 2);
      const expected = expectedFor(canonical);
      headers.forEach((h, col) => {
        const cell = sheetRow.getCell(col + 1).value;
        expect(cell == null ? '' : String(cell)).toBe(expected[h]);
      });
    });
  });

  it('every summary cell equals the canonical summary value', () => {
    const r = report();
    const wb = buildAttendanceWorkbook(r);
    const sheet = wb.worksheets[1];

    r.summaryRows.forEach((s, i) => {
      const row = sheet.getRow(i + 2);
      expect(row.getCell('Employee Name').value).toBe(s.employeeName);
      expect(row.getCell('Employee ID').value).toBe(s.employeeId);
      expect(row.getCell('Working Days').value).toBe(s.workingDays);
      expect(row.getCell('Present Days').value).toBe(s.presentDays);
      expect(row.getCell('Absent Days').value).toBe(s.absentDays);
      expect(row.getCell('Late Days').value).toBe(s.lateDays);
      expect(row.getCell('Total Presence Hours').value).toBe(s.totalPresenceHours);
      expect(row.getCell('Total Work Hours').value).toBe(s.totalWorkHours);
      expect(row.getCell('Unresolved Days').value).toBe(s.unresolvedDays);
    });
  });

  it('writes summary counts as NUMBERS so Finance can sum them', () => {
    const wb = buildAttendanceWorkbook(report());
    const row = wb.worksheets[1].getRow(2);

    for (const col of ['Working Days', 'Present Days', 'Total Presence Hours']) {
      expect(typeof row.getCell(col).value).toBe('number');
    }
  });

  it('carries the auto-close and missing-punch semantics into the sheet', () => {
    const r = report();
    const wb = buildAttendanceWorkbook(r);
    const sheet = wb.worksheets[0];

    // u-2's second day is the auto-closed session: Present, worked time known,
    // no punch out, presence unresolved.
    const autoClosed = r.dailyRows.findIndex(
      (x) => x.userId === 'u-2' && x.date === '2026-09-02',
    );
    const row = sheet.getRow(autoClosed + 2);

    expect(row.getCell('Attendance Status').value).toBe('Present');
    expect(row.getCell('Punch Out').value).toBe('—');
    expect(row.getCell('Total Presence Time').value).toBe('—');
    expect(String(row.getCell('Remarks / Exception').value)).toContain('auto-closed by policy');

    // u-1's second day has only a punch in.
    const onepunch = r.dailyRows.findIndex(
      (x) => x.userId === 'u-1' && x.date === '2026-09-02',
    );
    expect(sheet.getRow(onepunch + 2).getCell('Missing Punch').value).toBe('Punch Out');
  });

  it('renders deterministically: identical data gives identical bytes', async () => {
    const a = await workbookToBuffer(buildAttendanceWorkbook(report()));
    const b = await workbookToBuffer(buildAttendanceWorkbook(report()));

    // Nothing in the builder may read the clock.
    expect(a.equals(b)).toBe(true);
  });
});
