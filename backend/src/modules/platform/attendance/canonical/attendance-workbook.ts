import * as ExcelJS from 'exceljs';
import {
  DAILY_COLUMNS,
  SUMMARY_COLUMNS,
  type DailyAttendanceReportRow,
  type MonthReport,
  type MonthlyAttendanceSummaryRow,
} from './attendance-report';

/**
 * THE ONE WORKBOOK BUILDER.
 *
 * Exactly two sheets. No cover sheet, no diagnostics sheet, no raw sheet, no
 * hidden sheet. There were previously two builders producing four sheets
 * between them behind two download endpoints -- console/register-workbook.ts
 * and reports/payroll-workbook.ts -- which is why a figure could differ
 * depending on which button somebody pressed.
 *
 * THIS FILE FORMATS. IT DOES NOT DECIDE.
 *
 * Every value written here comes from a canonical report row already built by
 * attendance-report.ts. There is no arithmetic in this file beyond turning
 * minutes into an hours number for a column that asks for hours, and no
 * attendance rule at all. A builder that computed anything would be a second
 * opinion about the same day.
 *
 * The column order comes from DAILY_COLUMNS and SUMMARY_COLUMNS rather than
 * being written out again here, so the contract cannot drift between the
 * service, the sheet and the tests.
 */

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF1F5F9' },
};

/** Widths by column name. Anything unlisted gets a sensible default. */
const WIDTHS: Record<string, number> = {
  'Employee Name': 24,
  'Employee ID': 13,
  Department: 18,
  Designation: 22,
  'Employee Type': 14,
  Date: 12,
  'Attendance Status': 22,
  Present: 9,
  Absent: 9,
  'Half Day': 10,
  Leave: 9,
  'Punch In': 11,
  'Punch Out': 11,
  'Total Presence Time': 18,
  'Hours Worked': 13,
  'Break Time': 11,
  'Late Arrival': 15,
  '9-Hour Completion / Shortfall': 30,
  'Leave Type': 13,
  'Leave Deducted': 15,
  'LWP / Unpaid Portion': 19,
  'Comp Off': 10,
  'Manual Correction / Regularization': 32,
  'Missing Punch': 16,
  'Remarks / Exception': 44,
  'Data Source': 26,
  'Working Days': 13,
  'Present Days': 13,
  'Absent Days': 12,
  'Half Days': 11,
  'Leave Days': 11,
  'Late Days': 11,
  'Days Below 9 Hours': 18,
  'Total Presence Hours': 19,
  'Total Work Hours': 16,
  'Total Break Hours': 17,
  'CL Used': 10,
  'LWP / Unpaid Days': 17,
  'Attendance Deductions': 20,
  'Unresolved Days': 15,
};

function header(sheet: ExcelJS.Worksheet, columns: readonly string[]) {
  sheet.columns = columns.map((name) => ({
    header: name,
    key: name,
    width: WIDTHS[name] ?? 14,
  }));
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', wrapText: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
}

/** 'September 2026' from '2026-09'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${names[m - 1] ?? month} ${y}`;
}

/** The two sheet names, derived so the tests and the builder agree. */
export function sheetNames(month: string): { daily: string; summary: string } {
  return {
    daily: `${monthLabel(month)} Daily Attendance`,
    summary: 'Employee Monthly Summary',
  };
}

/**
 * Values keyed by visible column name.
 *
 * Mapped explicitly rather than by iterating the row's own keys: that way a
 * field renamed in the row type fails to compile here instead of silently
 * emptying a column in the delivered file.
 */
function dailyCells(r: DailyAttendanceReportRow): Record<string, string> {
  return {
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
  };
}

function summaryCells(s: MonthlyAttendanceSummaryRow): Record<string, string | number> {
  return {
    'Employee Name': s.employeeName,
    'Employee ID': s.employeeId,
    Department: s.department,
    Designation: s.designation,
    'Employee Type': s.employeeType,
    // Numbers as NUMBERS. Finance sums these, and a formatted string in a
    // spreadsheet is a value nobody can add up.
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
  };
}

export function buildAttendanceWorkbook(report: MonthReport): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apex OS Attendance';

  // Every timestamp pinned to the supplied instant, none to the clock. exceljs
  // defaults `modified` to new Date(), which made two renders of identical data
  // produce different bytes -- and anything hashing the output then reported a
  // change when only the clock had moved.
  wb.created = report.metadata.generatedAt;
  wb.modified = report.metadata.generatedAt;
  wb.lastModifiedBy = 'Apex OS Attendance';

  const names = sheetNames(report.month);

  const daily = wb.addWorksheet(names.daily);
  header(daily, DAILY_COLUMNS);
  for (const r of report.dailyRows) daily.addRow(dailyCells(r));

  const summary = wb.addWorksheet(names.summary);
  header(summary, SUMMARY_COLUMNS);
  for (const s of report.summaryRows) {
    const row = summary.addRow(summaryCells(s));
    // An unresolved count is marked in the file itself, so it survives being
    // sorted, filtered or pasted into another sheet.
    if (s.unresolvedDays > 0) {
      row.getCell('Unresolved Days').font = { bold: true, color: { argb: 'FFB45309' } };
    }
  }

  return wb;
}

export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Stable, sortable, and says what it is without being opened. */
export function attendanceWorkbookFilename(month: string): string {
  return `Apex_OS_Attendance_${month}.xlsx`;
}
