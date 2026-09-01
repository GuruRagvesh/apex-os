import * as ExcelJS from 'exceljs';
import {
  REGISTER_COLUMNS,
  formatBalance,
  formatCompletion,
  monthLabel,
  registerCsv,
  registerFileName,
  type RegisterResult,
} from '../../src/modules/platform/attendance/console/register-report';
import { buildRegisterWorkbook } from '../../src/modules/platform/attendance/console/register-workbook';
import {
  currentMonth,
  formatBalance as feFormatBalance,
  formatCompletion as feFormatCompletion,
  isFutureMonth,
  monthLabel as feMonthLabel,
  monthRange,
  registerFileName as feRegisterFileName,
  shiftMonth,
} from '../../../frontend/components/attendance/register-month';

/**
 * The register as it LEAVES the system.
 *
 * Two encodings of one result. What is proved here is that both carry the same
 * seven fields and nothing else: this file is emailed on, and a stray payroll
 * or GPS column would be a disclosure nobody chose to make.
 *
 * register-month.ts is imported straight out of the frontend tree. The frontend
 * has no test runner, and the two duplicated formatters are exactly the kind of
 * thing that drifts silently -- so the duplication is pinned by test instead of
 * trusted.
 */

const RESULT: RegisterResult = {
  month: '2026-09',
  workingDays: 22,
  employees: [
    {
      userId: 'u1',
      name: 'Ajay Singh',
      daysPresent: 21,
      daysAbsent: 1,
      halfDays: 1,
      leaveBalance: 7,
      latePunchIns: 3,
      attendanceCompletionPercentage: 95.45,
    },
    {
      userId: 'u2',
      // Every CSV hazard in one name.
      name: 'Suryawanshi, "Shubham"\nJr',
      daysPresent: 0,
      daysAbsent: 0,
      halfDays: 0,
      leaveBalance: null,
      latePunchIns: 0,
      attendanceCompletionPercentage: null,
    },
  ],
};

describe('the register carries exactly seven fields', () => {
  it('1. names the seven columns the brief asked for, in order', () => {
    expect(REGISTER_COLUMNS.map((c) => c.header)).toEqual([
      'Name',
      'No. of Days Present',
      'No. of Days Absent',
      'No. of Half Days',
      'Leave Balance',
      'No. of Late Punch-ins',
      'Attendance Completion %',
    ]);
  });

  it('2. the CSV header is those seven and nothing else', () => {
    const header = registerCsv(RESULT).replace(/^﻿/, '').split('\r\n')[0];
    expect(header.split(',')).toHaveLength(7);
    expect(header).toBe(
      'Name,No. of Days Present,No. of Days Absent,No. of Half Days,Leave Balance,No. of Late Punch-ins,Attendance Completion %',
    );
  });

  it('3. no payroll, salary, evidence or exception column reaches either export', async () => {
    const wb = buildRegisterWorkbook(RESULT, new Date('2026-09-30T00:00:00.000Z'));
    const sheet = wb.getWorksheet('Monthly Register')!;

    const text: string[] = [];
    sheet.eachRow((row) => {
      row.eachCell((cell) => text.push(String(cell.value ?? '')));
    });
    const everything = `${text.join(' ')} ${registerCsv(RESULT)}`.toLowerCase();

    for (const forbidden of [
      'salary', 'payroll', 'gross', 'net pay', 'ctc',
      'latitude', 'longitude', 'gps', 'photo', 'accuracy',
      'punch in', 'punch out', 'geofence', 'exception', 'lwp',
    ]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it('4. the workbook has exactly one sheet, named for what it is', () => {
    const wb = buildRegisterWorkbook(RESULT, new Date('2026-09-30T00:00:00.000Z'));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Monthly Register']);
  });
});

describe('the two exports read one result', () => {
  const generatedAt = new Date('2026-09-30T00:00:00.000Z');

  it('5. every employee figure is identical in the CSV and the workbook', () => {
    const wb = buildRegisterWorkbook(RESULT, generatedAt);
    const sheet = wb.getWorksheet('Monthly Register')!;
    const csvRows = registerCsv(RESULT)
      .replace(/^﻿/, '')
      .split('\r\n')
      .filter(Boolean);

    RESULT.employees.forEach((e, i) => {
      // Heading block is 4 rows, the column header is row 5, so data starts at 6.
      const row = sheet.getRow(6 + i);
      expect(row.getCell(2).value).toBe(e.daysPresent);
      expect(row.getCell(3).value).toBe(e.daysAbsent);
      expect(row.getCell(4).value).toBe(e.halfDays);
      expect(row.getCell(6).value).toBe(e.latePunchIns);

      // And the CSV line carries the same numbers.
      const csv = csvRows[i + 1];
      expect(csv).toContain(`,${e.daysPresent},${e.daysAbsent},${e.halfDays},`);
    });
  });

  it('6. the completion is a real Excel percentage, not a pre-formatted string', () => {
    const wb = buildRegisterWorkbook(RESULT, generatedAt);
    const cell = wb.getWorksheet('Monthly Register')!.getRow(6).getCell(7);

    // 0.9545 with a percent format, not 95.45 (which would render 9545%) and
    // not "95.45%" (which nothing can average).
    expect(cell.value).toBeCloseTo(0.9545, 6);
    expect(cell.numFmt).toBe('0.00%');
  });

  it('7. an unmeasurable employee is blank in Excel and a dash in the CSV, never zero', () => {
    const wb = buildRegisterWorkbook(RESULT, generatedAt);
    const row = wb.getWorksheet('Monthly Register')!.getRow(7);

    expect(row.getCell(5).value).toBeNull();
    expect(row.getCell(7).value).toBeNull();

    const csv = registerCsv(RESULT).split('\r\n')[2];
    expect(csv).toContain('—');
    expect(csv).not.toMatch(/,0\.00%/);
  });

  it('8. the workbook says which month and how many working days it covers', () => {
    const wb = buildRegisterWorkbook(RESULT, generatedAt);
    const sheet = wb.getWorksheet('Monthly Register')!;

    expect(String(sheet.getRow(2).getCell(1).value)).toBe('Month: September 2026');
    expect(String(sheet.getRow(3).getCell(1).value)).toBe('Working Days: 22');
  });

  it('9. two renders of the same result produce the same bytes', async () => {
    const a = await buildRegisterWorkbook(RESULT, generatedAt).xlsx.writeBuffer();
    const b = await buildRegisterWorkbook(RESULT, generatedAt).xlsx.writeBuffer();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('10. the workbook actually opens', async () => {
    const buffer = await buildRegisterWorkbook(RESULT, generatedAt).xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer as any);

    const sheet = reopened.getWorksheet('Monthly Register')!;
    expect(String(sheet.getRow(6).getCell(1).value)).toBe('Ajay Singh');
  });
});

describe('CSV escaping', () => {
  it('11. a name with a comma, a quote and a newline stays in its own column', () => {
    const csv = registerCsv(RESULT).replace(/^﻿/, '');

    // RFC 4180: the whole field is quoted and inner quotes are doubled.
    expect(csv).toContain('"Suryawanshi, ""Shubham""\nJr"');

    // And the row still carries its six figures after the name. An unescaped
    // comma would shift every one of them a column to the left.
    const afterName = csv.slice(csv.indexOf('Jr"') + 3);
    expect(afterName.startsWith(',0,0,0,—,0,—')).toBe(true);
  });

  it('12. a UTF-8 BOM leads, so Excel on Windows does not mangle names', () => {
    expect(registerCsv(RESULT).startsWith('﻿')).toBe(true);
  });

  it('13. CRLF line endings, because this file is opened far more than parsed', () => {
    expect(registerCsv(RESULT)).toContain('\r\n');
    expect(registerCsv(RESULT).endsWith('\r\n')).toBe(true);
  });
});

describe('presentation is honest about what is not known', () => {
  it('14. a null percentage is a dash, never 0%, NaN or Infinity', () => {
    expect(formatCompletion(null)).toBe('—');
    expect(formatCompletion(undefined as any)).toBe('—');
    expect(formatCompletion(0)).toBe('0.00%');
    expect(formatCompletion(95.45)).toBe('95.45%');
    expect(formatCompletion(100)).toBe('100.00%');
  });

  it('15. a null leave balance is a dash, not none left', () => {
    expect(formatBalance(null)).toBe('—');
    expect(formatBalance(0)).toBe('0');
  });

  it('16. the file is named for the month a human asked for', () => {
    expect(registerFileName('2026-09', 'xlsx')).toBe('Attendance_Register_September_2026.xlsx');
    expect(registerFileName('2026-01', 'csv')).toBe('Attendance_Register_January_2026.csv');
  });
});

describe('the frontend copies cannot drift from the backend', () => {
  const months = ['2026-01', '2026-02', '2026-09', '2026-12', '2027-06'];

  it('17. month labels agree', () => {
    for (const m of months) expect(feMonthLabel(m)).toBe(monthLabel(m));
  });

  it('18. file names agree', () => {
    for (const m of months) {
      expect(feRegisterFileName(m, 'xlsx')).toBe(registerFileName(m, 'xlsx'));
      expect(feRegisterFileName(m, 'csv')).toBe(registerFileName(m, 'csv'));
    }
  });

  it('19. the displayed percentage and balance agree', () => {
    for (const v of [null, 0, 66.666, 95.45, 100]) {
      expect(feFormatCompletion(v)).toBe(formatCompletion(v));
    }
    for (const v of [null, 0, 7]) expect(feFormatBalance(v)).toBe(formatBalance(v));
  });
});

describe('month navigation', () => {
  it('20. stepping forward from December lands in January of the next year', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
  });

  it('21. the range covers the whole month, February and leap years included', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('22. a month that has not started is refused; the current one is not', () => {
    const now = new Date('2026-09-01T10:00:00.000Z');
    expect(currentMonth(now)).toBe('2026-09');
    expect(isFutureMonth('2026-10', now)).toBe(true);
    expect(isFutureMonth('2026-09', now)).toBe(false);
    expect(isFutureMonth('2026-08', now)).toBe(false);
  });
});
