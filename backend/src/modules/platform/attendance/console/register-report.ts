/**
 * The monthly attendance register, as HR reads it and as it leaves the system.
 *
 * Seven columns. Not eight, not "seven plus a couple that were useful during
 * development" -- the register is a document HR forwards, and every extra
 * column is something that has to be explained to whoever receives it. Punch
 * timestamps, GPS, photographs, exception codes and anything payroll-shaped are
 * deliberately absent.
 *
 * Pure and dependency-free on purpose: the same values reach the table, the
 * workbook and the CSV, so all three are provably showing one answer rather
 * than three implementations of the same formula that drift apart.
 */

/** One employee's row, exactly as the register presents it. */
export interface RegisterEmployee {
  userId: string;
  name: string;
  daysPresent: number;
  daysAbsent: number;
  halfDays: number;
  /** Null when leave data could not be read for this employee. */
  leaveBalance: number | null;
  latePunchIns: number;
  /** Null when there is no eligible working day to measure against. */
  attendanceCompletionPercentage: number | null;
}

export interface RegisterResult {
  /** yyyy-MM */
  month: string;
  /** Scheduled working days in the WHOLE month. */
  workingDays: number;
  employees: RegisterEmployee[];
}

/**
 * The seven columns, in order, defined once.
 *
 * Both exporters read this list rather than repeating the headers, so a column
 * cannot appear in the CSV and be missing from the workbook.
 */
export const REGISTER_COLUMNS = [
  { key: 'name', header: 'Name' },
  { key: 'daysPresent', header: 'No. of Days Present' },
  { key: 'daysAbsent', header: 'No. of Days Absent' },
  { key: 'halfDays', header: 'No. of Half Days' },
  { key: 'leaveBalance', header: 'Leave Balance' },
  { key: 'latePunchIns', header: 'No. of Late Punch-ins' },
  { key: 'attendanceCompletionPercentage', header: 'Attendance Completion %' },
] as const;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `2026-09` -> `September 2026`. */
export function monthLabel(month: string): string {
  const [year, mon] = month.split('-');
  const name = MONTHS[Number(mon) - 1];
  if (!name || !year) return month;
  return `${name} ${year}`;
}

/** `Attendance_Register_September_2026.xlsx` */
export function registerFileName(month: string, extension: 'xlsx' | 'csv'): string {
  return `Attendance_Register_${monthLabel(month).replace(/\s+/g, '_')}.${extension}`;
}

/**
 * A dash, not 0% and not NaN.
 *
 * An employee with no eligible working days has not scored zero -- nothing has
 * been measured about them yet, and printing 0% next to a name is an accusation
 * the data does not support.
 */
export function formatCompletion(value: number | null): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)}%`;
}

/** A missing leave balance reads as unknown rather than as none left. */
export function formatBalance(value: number | null): string {
  return value === null || value === undefined ? '—' : String(value);
}

/**
 * RFC 4180 quoting.
 *
 * Employee names carry commas ("Singh, Ajay"), apostrophes and occasionally
 * quotes; an unescaped one silently shifts every following column, which turns
 * a name into an attendance figure without anything looking broken.
 */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The CSV, byte for byte.
 *
 * A UTF-8 BOM leads: without it Excel on Windows decodes the file as the local
 * ANSI codepage and mangles every non-ASCII name. CRLF line endings for the
 * same reason -- this file is opened in Excel far more often than it is parsed.
 */
export function registerCsv(result: RegisterResult): string {
  const lines = [REGISTER_COLUMNS.map((c) => csvCell(c.header)).join(',')];

  for (const e of result.employees) {
    lines.push(
      [
        csvCell(e.name ?? ''),
        String(e.daysPresent),
        String(e.daysAbsent),
        String(e.halfDays),
        csvCell(formatBalance(e.leaveBalance)),
        String(e.latePunchIns),
        csvCell(formatCompletion(e.attendanceCompletionPercentage)),
      ].join(','),
    );
  }

  return `﻿${lines.join('\r\n')}\r\n`;
}
