/**
 * The two sheets' columns, defined once.
 *
 * Both encoders read these lists rather than repeating headers, so a column
 * cannot reach the CSV and be missing from the workbook, appear in a different
 * order, or carry a different type. The removed columns (Data Source,
 * Attendance Finalization Status, Attended Day Fraction, Approved Leave Day
 * Fraction, Required Presence Minutes, Business Date Eligibility) and every
 * internal id are absent by construction: nothing outside these lists is ever
 * written.
 */

/**
 * How a value is typed in the workbook and spelled in the CSV.
 *
 *   text     string
 *   date     yyyy-MM-dd -> Excel date
 *   time     HH:mm company wall clock -> Excel time
 *   hours    decimal hours, 2 dp
 *   number   decimal, up to 2 dp (day fractions, deductions)
 *   count    integer
 *   percent  fraction 0..1, 4 dp -> Excel percentage
 */
export type ColumnType = 'text' | 'date' | 'time' | 'hours' | 'number' | 'count' | 'percent';

export interface ReportColumn {
  key: string;
  header: string;
  type: ColumnType;
  width: number;
}

export const DAILY_COLUMNS: readonly ReportColumn[] = [
  { key: 'employeeId', header: 'Employee ID', type: 'text', width: 13 },
  { key: 'employeeName', header: 'Employee Name', type: 'text', width: 24 },
  { key: 'department', header: 'Department', type: 'text', width: 18 },
  { key: 'designation', header: 'Designation', type: 'text', width: 20 },
  { key: 'employeeType', header: 'Employee Type', type: 'text', width: 14 },
  { key: 'date', header: 'Date', type: 'date', width: 12 },
  { key: 'attendanceStatus', header: 'Attendance Status', type: 'text', width: 24 },
  { key: 'present', header: 'Present', type: 'number', width: 9 },
  { key: 'absent', header: 'Absent', type: 'number', width: 9 },
  { key: 'halfDay', header: 'Half Day', type: 'number', width: 9 },
  { key: 'leave', header: 'Leave', type: 'number', width: 9 },
  { key: 'punchIn', header: 'Punch In', type: 'time', width: 10 },
  { key: 'punchOut', header: 'Punch Out', type: 'time', width: 10 },
  { key: 'presenceHours', header: 'Total Presence Hours', type: 'hours', width: 12 },
  { key: 'workHours', header: 'Total Work Hours', type: 'hours', width: 12 },
  { key: 'punchInLocation', header: 'Punch In Location', type: 'text', width: 36 },
  { key: 'punchOutLocation', header: 'Punch Out Location', type: 'text', width: 36 },
  { key: 'breakHours', header: 'Total Break Hours', type: 'hours', width: 12 },
  { key: 'meetingHours', header: 'Meeting Hours', type: 'hours', width: 11 },
  { key: 'meetingVerification', header: 'Meeting Verification Status', type: 'text', width: 16 },
  { key: 'lateArrival', header: 'Late Arrival', type: 'text', width: 10 },
  { key: 'nineHourCompletion', header: '9-Hour Completion / Shortfall', type: 'text', width: 18 },
  { key: 'leaveType', header: 'Leave Type', type: 'text', width: 16 },
  { key: 'leaveDeducted', header: 'Leave Deducted', type: 'number', width: 11 },
  { key: 'lwpPortion', header: 'LWP / Unpaid Portion', type: 'number', width: 12 },
  { key: 'compOff', header: 'Comp Off', type: 'hours', width: 10 },
  { key: 'regularized', header: 'Regularized / Corrected', type: 'text', width: 13 },
  { key: 'missingPunch', header: 'Missing Punch Details', type: 'text', width: 20 },
  { key: 'schedule', header: 'Scheduled Workday / Weekly Off / Holiday', type: 'text', width: 20 },
  { key: 'coverage', header: 'Verification / Data Coverage Status', type: 'text', width: 22 },
  { key: 'presenceCompletion', header: 'Presence Completion %', type: 'percent', width: 12 },
  { key: 'punctuality', header: 'Punctuality Verification Status', type: 'text', width: 18 },
  { key: 'disputeStatus', header: 'Attendance Dispute Status', type: 'text', width: 24 },
  { key: 'hrReview', header: 'HR Review Status', type: 'text', width: 24 },
  { key: 'remarks', header: 'Employee Remarks / Exception', type: 'text', width: 40 },
];

export const MONTHLY_COLUMNS: readonly ReportColumn[] = [
  { key: 'employeeId', header: 'Employee ID', type: 'text', width: 13 },
  { key: 'employeeName', header: 'Employee Name', type: 'text', width: 24 },
  { key: 'department', header: 'Department', type: 'text', width: 18 },
  { key: 'designation', header: 'Designation', type: 'text', width: 20 },
  { key: 'employeeType', header: 'Employee Type', type: 'text', width: 14 },
  { key: 'month', header: 'Month', type: 'text', width: 15 },
  { key: 'financialYear', header: 'Financial Year', type: 'text', width: 12 },
  { key: 'workingDays', header: 'Working Days', type: 'count', width: 10 },
  { key: 'presentDays', header: 'Present Days', type: 'number', width: 10 },
  { key: 'absentDays', header: 'Absent Days', type: 'number', width: 10 },
  { key: 'halfDays', header: 'Half Days', type: 'number', width: 10 },
  { key: 'leaveDays', header: 'Leave Days', type: 'number', width: 10 },
  { key: 'weeklyOffDays', header: 'Weekly Off Days', type: 'count', width: 10 },
  { key: 'holidayDays', header: 'Holiday Days', type: 'count', width: 10 },
  { key: 'notYetJoinedDays', header: 'Not Yet Joined Days', type: 'count', width: 10 },
  { key: 'unresolvedDays', header: 'Unresolved Days', type: 'count', width: 10 },
  { key: 'lateDays', header: 'Late Days', type: 'count', width: 9 },
  { key: 'daysBelowNineHours', header: 'Days Below 9 Hours', type: 'count', width: 10 },
  { key: 'presenceHours', header: 'Total Presence Hours', type: 'hours', width: 12 },
  { key: 'workHours', header: 'Total Work Hours', type: 'hours', width: 12 },
  { key: 'breakHours', header: 'Total Break Hours', type: 'hours', width: 12 },
  { key: 'meetingDays', header: 'Total Meeting Days', type: 'count', width: 10 },
  { key: 'meetingHours', header: 'Total Meeting Hours', type: 'hours', width: 11 },
  { key: 'approvedMeetingHours', header: 'Approved Meeting Hours', type: 'hours', width: 11 },
  { key: 'pendingMeetingApprovals', header: 'Pending Meeting Approvals', type: 'count', width: 11 },
  { key: 'clUsed', header: 'CL Used', type: 'number', width: 9 },
  { key: 'lwpDays', header: 'LWP / Unpaid Days', type: 'number', width: 11 },
  { key: 'attendanceDeductions', header: 'Attendance Deductions', type: 'number', width: 12 },
  { key: 'approvedCompOff', header: 'Approved Comp Off', type: 'hours', width: 11 },
  { key: 'missingPunch', header: 'Missing Punch Days / Details', type: 'text', width: 34 },
  { key: 'eligibleWorkingDays', header: 'Eligible Working Days', type: 'number', width: 11 },
  { key: 'attendancePercent', header: 'Attendance %', type: 'percent', width: 11 },
  { key: 'presenceCompletion', header: 'Presence Completion %', type: 'percent', width: 12 },
  { key: 'punctualityPercent', header: 'Punctuality %', type: 'percent', width: 11 },
  { key: 'coveragePercent', header: 'Verified Attendance Coverage %', type: 'percent', width: 13 },
  { key: 'provisional', header: 'Provisional Reporting Flag', type: 'text', width: 12 },
  { key: 'pendingDisputes', header: 'Pending Attendance Disputes', type: 'count', width: 11 },
];

/**
 * Labels that must never appear in either export, as a header or anywhere
 * else. Kept as data so the tests and the encoders share one list.
 */
export const REMOVED_COLUMN_HEADERS = [
  'Data Source',
  'Attendance Finalization Status',
  'Attended Day Fraction',
  'Approved Leave Day Fraction',
  'Required Presence Minutes',
  'Business Date Eligibility',
] as const;

export const DAILY_SHEET_NAME = 'Daily Attendance';
export const MONTHLY_SHEET_NAME = 'Monthly Summary';

/** Spreadsheet column letter for a 1-based index. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 1-based position of a key in a column list. */
export function columnIndex(columns: readonly ReportColumn[], key: string): number {
  const i = columns.findIndex((c) => c.key === key);
  if (i < 0) throw new Error(`Unknown report column: ${key}`);
  return i + 1;
}

/** Rounds to a fixed number of decimals without binary noise (0.1 + 0.2). */
export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * The CSV spelling of a canonical value.
 *
 * The workbook stores the same canonical value as a typed cell; this is how
 * that typed cell reads as text. Blank stays blank: a missing measurement is
 * never printed as 0.
 */
export function formatCell(type: ColumnType, value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '';
  switch (type) {
    case 'hours':
      return (value as number).toFixed(2);
    case 'percent':
      return `${((value as number) * 100).toFixed(2)}%`;
    case 'count':
      return String(Math.round(value as number));
    case 'number':
      return String(round(value as number, 2));
    default:
      return String(value);
  }
}
