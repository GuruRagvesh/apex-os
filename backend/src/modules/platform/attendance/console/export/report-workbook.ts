import * as ExcelJS from 'exceljs';
import {
  DAILY_COLUMNS,
  DAILY_SHEET_NAME,
  MONTHLY_COLUMNS,
  MONTHLY_SHEET_NAME,
  columnIndex,
  columnLetter,
  type ColumnType,
  type ReportColumn,
} from './report-columns';
import { DAY_STATES, SCHEDULE, type CellValue, type MonthlyAttendanceReport } from './report-model';
import { CASUAL_LEAVE_LABEL } from './report-assembler';

/**
 * The monthly attendance report as a two-sheet workbook.
 *
 * Exactly two sheets, Daily Attendance and Monthly Summary, and nothing else.
 * Every value is the canonical report's value, written as a typed cell: dates
 * as dates, punch times as times, hours and counts as numbers, percentages as
 * real percentages, so HR can sort, filter and sum them.
 *
 * Where a Monthly Summary figure is a plain aggregate of the daily rows it is
 * written as a FORMULA over that employee's Daily Attendance range, so HR can
 * see how it was formed -- and every formula carries the backend's own value
 * as its cached result. The backend stays authoritative; the workbook never
 * depends on Excel recalculating to show a number, and the formulas are
 * written to reproduce exactly the cached value (rounded identically).
 */

const TITLE_ROW = 1;
const NOTE_ROW = 2;
export const HEADER_ROW = 3;
export const FIRST_DATA_ROW = 4;

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const PROVISIONAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFBFBFBF' } };

const NUM_FMT: Record<ColumnType, string | undefined> = {
  text: undefined,
  date: 'dd-mmm-yyyy',
  time: 'hh:mm',
  hours: '0.00',
  number: 'General',
  count: '0',
  percent: '0.00%',
};

/** The typed cell value for a canonical value. */
export function excelValue(type: ColumnType, value: CellValue): ExcelJS.CellValue {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case 'date': {
      const [y, m, d] = String(value).split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    }
    case 'time': {
      const [h, m] = String(value).split(':').map(Number);
      // Excel stores a time of day as a fraction of 24 hours.
      return (h * 60 + m) / 1440;
    }
    default:
      return value as ExcelJS.CellValue;
  }
}

function writeHeader(sheet: ExcelJS.Worksheet, columns: readonly ReportColumn[], title: string, note: string, provisional: boolean) {
  const lastLetter = columnLetter(columns.length);
  sheet.getCell(`A${TITLE_ROW}`).value = title;
  sheet.getCell(`A${TITLE_ROW}`).font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };
  sheet.mergeCells(`A${TITLE_ROW}:${lastLetter}${TITLE_ROW}`);
  sheet.getRow(TITLE_ROW).height = 22;

  sheet.getCell(`A${NOTE_ROW}`).value = note;
  sheet.getCell(`A${NOTE_ROW}`).font = { italic: true, size: 10, color: { argb: provisional ? 'FF7F6000' : 'FF375623' } };
  if (provisional) sheet.getCell(`A${NOTE_ROW}`).fill = PROVISIONAL_FILL;
  sheet.mergeCells(`A${NOTE_ROW}:${lastLetter}${NOTE_ROW}`);

  const header = sheet.getRow(HEADER_ROW);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
    sheet.getColumn(i + 1).width = c.width;
  });
  // Tall enough for the longest header to wrap onto three lines unclipped.
  header.height = 48;

  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: HEADER_ROW, topLeftCell: `C${FIRST_DATA_ROW}` }];
}

function styleDataRow(row: ExcelJS.Row, columns: readonly ReportColumn[]) {
  columns.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    const fmt = NUM_FMT[c.type];
    if (fmt) cell.numFmt = fmt;
    cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
    cell.alignment = {
      vertical: 'top',
      wrapText: c.type === 'text',
      horizontal: c.type === 'text' ? 'left' : 'right',
    };
  });
}

/**
 * Monthly Summary formulas, keyed by column.
 *
 * Each returns the formula text for one employee, given the ranges of that
 * employee's Daily Attendance rows and the addresses of the summary row's own
 * cells. A key absent here is written as a static value: it either is not a
 * function of the visible daily columns (approved meeting hours, verified
 * coverage) or is descriptive text.
 */
type FormulaContext = { daily: (key: string) => string; self: (key: string) => string };

const q = (text: string) => `"${text.replace(/"/g, '""')}"`;

const MONTHLY_FORMULAS: Record<string, (c: FormulaContext) => string> = {
  workingDays: (c) =>
    `COUNTIFS(${c.daily('schedule')},${q(SCHEDULE.WORKDAY)},${c.daily('attendanceStatus')},${q(`<>${DAY_STATES.NOT_YET_JOINED}`)},${c.daily('attendanceStatus')},${q(`<>${DAY_STATES.POST_EMPLOYMENT}`)})`,
  presentDays: (c) => `ROUND(SUM(${c.daily('present')}),2)`,
  absentDays: (c) => `ROUND(SUM(${c.daily('absent')}),2)`,
  halfDays: (c) => `ROUND(SUM(${c.daily('halfDay')}),2)`,
  leaveDays: (c) => `ROUND(SUM(${c.daily('leave')}),2)`,
  weeklyOffDays: (c) =>
    `COUNTIFS(${c.daily('schedule')},${q(SCHEDULE.WEEKLY_OFF)},${c.daily('attendanceStatus')},${q(DAY_STATES.WEEKLY_OFF)})+COUNTIFS(${c.daily('schedule')},${q(SCHEDULE.WEEKLY_OFF)},${c.daily('attendanceStatus')},${q(DAY_STATES.HOLIDAY_WORKED)})`,
  holidayDays: (c) =>
    `COUNTIFS(${c.daily('schedule')},${q(SCHEDULE.HOLIDAY)},${c.daily('attendanceStatus')},${q(DAY_STATES.HOLIDAY)})+COUNTIFS(${c.daily('schedule')},${q(SCHEDULE.HOLIDAY)},${c.daily('attendanceStatus')},${q(DAY_STATES.HOLIDAY_WORKED)})`,
  notYetJoinedDays: (c) => `COUNTIF(${c.daily('attendanceStatus')},${q(DAY_STATES.NOT_YET_JOINED)})`,
  unresolvedDays: (c) => `COUNTIF(${c.daily('attendanceStatus')},${q(DAY_STATES.NEEDS_REVIEW)})`,
  lateDays: (c) => `COUNTIF(${c.daily('lateArrival')},"Yes")`,
  daysBelowNineHours: (c) => `COUNTIF(${c.daily('nineHourCompletion')},"Shortfall*")`,
  presenceHours: (c) => `ROUND(SUM(${c.daily('presenceHours')}),2)`,
  workHours: (c) => `ROUND(SUM(${c.daily('workHours')}),2)`,
  breakHours: (c) => `ROUND(SUM(${c.daily('breakHours')}),2)`,
  meetingDays: (c) => `COUNTIF(${c.daily('meetingHours')},">0")`,
  meetingHours: (c) => `ROUND(SUM(${c.daily('meetingHours')}),2)`,
  clUsed: (c) => `ROUND(SUMIFS(${c.daily('leave')},${c.daily('leaveType')},${q(CASUAL_LEAVE_LABEL)}),2)`,
  lwpDays: (c) =>
    `ROUND(SUMIFS(${c.daily('lwpPortion')},${c.daily('attendanceStatus')},${q(DAY_STATES.LWP)})+SUMIFS(${c.daily('lwpPortion')},${c.daily('attendanceStatus')},${q(DAY_STATES.HALF_DAY)}),2)`,
  attendanceDeductions: (c) => `ROUND(SUM(${c.daily('lwpPortion')})-${c.self('lwpDays')},2)`,
  approvedCompOff: (c) => `ROUND(SUM(${c.daily('compOff')}),2)`,
  eligibleWorkingDays: (c) => `ROUND(${c.self('presentDays')}+${c.self('absentDays')}+${c.self('halfDays')},2)`,
  attendancePercent: (c) =>
    `IF(OR(${c.self('unresolvedDays')}>0,${c.self('eligibleWorkingDays')}=0),"",ROUND((${c.self('presentDays')}+0.5*${c.self('halfDays')})/${c.self('eligibleWorkingDays')},4))`,
  punctualityPercent: (c) => {
    const yes = `COUNTIF(${c.daily('lateArrival')},"Yes")`;
    const no = `COUNTIF(${c.daily('lateArrival')},"No")`;
    return `IF(${yes}+${no}=0,"",ROUND(${no}/(${yes}+${no}),4))`;
  },
};

export const FORMULA_KEYS = Object.keys(MONTHLY_FORMULAS);

export function buildMonthlyAttendanceWorkbook(report: MonthlyAttendanceReport): ExcelJS.Workbook {
  const { metadata } = report;
  const wb = new ExcelJS.Workbook();
  // File metadata, not report columns. Pinned to the report's instant so the
  // properties say when THIS data was read.
  wb.creator = 'Apex OS Attendance';
  wb.lastModifiedBy = 'Apex OS Attendance';
  wb.created = metadata.generatedAt;
  wb.modified = metadata.generatedAt;
  wb.title = `Attendance Report - ${metadata.monthLabel}`;
  wb.subject = 'Monthly attendance';
  wb.description = `Generated at ${metadata.generatedAt.toISOString()} (company timezone ${metadata.timezone}). ${metadata.provisional ? 'Provisional.' : 'Final for the month.'}`;
  wb.keywords = `attendance ${metadata.month}`;
  // Recalculate on open is harmless (the formulas reproduce the cached values)
  // and keeps a hand-edited workbook honest.
  wb.calcProperties = { fullCalcOnLoad: true };

  const scopeText = `${metadata.scope === 'COMPANY' ? 'Company' : 'Team'} scope${metadata.departmentName ? `, department ${metadata.departmentName}` : ''}`;
  const note = metadata.provisional
    ? `PROVISIONAL - figures can still change (open days, corrections or reviews). ${scopeText}.`
    : `Final for the month. ${scopeText}.`;

  // ── Daily Attendance ──
  const daily = wb.addWorksheet(DAILY_SHEET_NAME);
  writeHeader(daily, DAILY_COLUMNS, `Apex OS - Daily Attendance - ${metadata.monthLabel}`, note, metadata.provisional);
  report.dailyRows.forEach((r, i) => {
    const row = daily.getRow(FIRST_DATA_ROW + i);
    DAILY_COLUMNS.forEach((c, j) => {
      row.getCell(j + 1).value = excelValue(c.type, r.values[c.key] ?? null);
    });
    styleDataRow(row, DAILY_COLUMNS);
  });
  const dailyLast = FIRST_DATA_ROW + Math.max(report.dailyRows.length, 1) - 1;
  daily.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: dailyLast, column: DAILY_COLUMNS.length } };

  // ── Monthly Summary ──
  const monthly = wb.addWorksheet(MONTHLY_SHEET_NAME);
  writeHeader(monthly, MONTHLY_COLUMNS, `Apex OS - Monthly Attendance Summary - ${metadata.monthLabel}`, note, metadata.provisional);
  const sheetRef = `'${DAILY_SHEET_NAME}'!`;
  report.monthlySummaryRows.forEach((r, i) => {
    const rowNumber = FIRST_DATA_ROW + i;
    const row = monthly.getRow(rowNumber);
    const r1 = FIRST_DATA_ROW + r.dailyRange.first;
    const r2 = FIRST_DATA_ROW + r.dailyRange.last;
    const ctx: FormulaContext = {
      daily: (key) => {
        const l = columnLetter(columnIndex(DAILY_COLUMNS, key));
        return `${sheetRef}$${l}$${r1}:$${l}$${r2}`;
      },
      self: (key) => `${columnLetter(columnIndex(MONTHLY_COLUMNS, key))}${rowNumber}`,
    };
    MONTHLY_COLUMNS.forEach((c, j) => {
      const value = r.values[c.key] ?? null;
      const formula = MONTHLY_FORMULAS[c.key];
      row.getCell(j + 1).value = formula
        ? // The backend's value IS the cached result. A blank percentage is an
          // empty string, which is also what the formula's IF returns.
          ({ formula: formula(ctx), result: value === null ? '' : value } as ExcelJS.CellFormulaValue)
        : excelValue(c.type, value);
    });
    styleDataRow(row, MONTHLY_COLUMNS);
    if (r.values.provisional === 'Yes') {
      row.getCell(columnIndex(MONTHLY_COLUMNS, 'provisional')).fill = PROVISIONAL_FILL;
    }
  });
  const monthlyLast = FIRST_DATA_ROW + Math.max(report.monthlySummaryRows.length, 1) - 1;
  monthly.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: monthlyLast, column: MONTHLY_COLUMNS.length } };

  return wb;
}

export async function monthlyAttendanceWorkbookBuffer(report: MonthlyAttendanceReport): Promise<Buffer> {
  return Buffer.from(await buildMonthlyAttendanceWorkbook(report).xlsx.writeBuffer());
}
