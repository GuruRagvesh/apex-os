import { DAILY_COLUMNS, MONTHLY_COLUMNS, formatCell, type ReportColumn } from './report-columns';
import type { CellValue, MonthlyAttendanceReport } from './report-model';
import { buildZip } from './zip';

/**
 * The monthly attendance report as a CSV package: one ZIP holding exactly
 *
 *   Daily_Attendance_<Month>_<Year>.csv
 *   Monthly_Summary_<Month>_<Year>.csv
 *
 * Same columns, same order, same rows and the same values as the matching
 * workbook sheets -- both are encodings of one MonthlyAttendanceReport. The CSV
 * carries the evaluated values, never formula text.
 */

/** `September_2026` -- letters, digits and underscores only. */
export function fileMonthToken(monthLabel: string): string {
  return monthLabel.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function dailyCsvName(monthLabel: string) {
  return `Daily_Attendance_${fileMonthToken(monthLabel)}.csv`;
}

export function monthlyCsvName(monthLabel: string) {
  return `Monthly_Summary_${fileMonthToken(monthLabel)}.csv`;
}

export function workbookName(monthLabel: string) {
  return `Attendance_Report_${fileMonthToken(monthLabel)}.xlsx`;
}

export function packageName(monthLabel: string) {
  return `Attendance_Report_${fileMonthToken(monthLabel)}_CSV.zip`;
}

/**
 * RFC 4180 quoting, plus formula neutralising.
 *
 * Names and remarks carry commas, quotes and line breaks; any of those
 * unescaped shifts every following column. A text cell that starts with = + -
 * or @ would be EXECUTED by Excel when the CSV is opened, so it is prefixed
 * with a single quote, which Excel treats as "this is text".
 */
export function csvCell(text: string): string {
  let value = text;
  if (/^[=+\-@]/.test(value)) value = `'${value}`;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvLine(columns: readonly ReportColumn[], values: Record<string, CellValue>): string {
  return columns
    .map((c) => {
      const text = formatCell(c.type, values[c.key] ?? null);
      // Only free text can contain a formula-looking value; typed numbers,
      // times and dates are written by the formatter and are never quoted.
      return c.type === 'text' ? csvCell(text) : text;
    })
    .join(',');
}

/** UTF-8 with BOM, CRLF -- the form Excel on Windows opens without mangling names. */
function csvDocument(columns: readonly ReportColumn[], rows: Array<Record<string, CellValue>>): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const r of rows) lines.push(csvLine(columns, r));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function dailyCsv(report: MonthlyAttendanceReport): string {
  return csvDocument(DAILY_COLUMNS, report.dailyRows.map((r) => r.values));
}

export function monthlyCsv(report: MonthlyAttendanceReport): string {
  return csvDocument(MONTHLY_COLUMNS, report.monthlySummaryRows.map((r) => r.values));
}

/** Wall-clock parts of an instant in a timezone, for the ZIP entry stamps. */
function zonedParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

export function csvPackage(report: MonthlyAttendanceReport): Buffer {
  const { metadata } = report;
  return buildZip(
    [
      { name: dailyCsvName(metadata.monthLabel), data: Buffer.from(dailyCsv(report), 'utf8') },
      { name: monthlyCsvName(metadata.monthLabel), data: Buffer.from(monthlyCsv(report), 'utf8') },
    ],
    zonedParts(metadata.generatedAt, metadata.timezone),
    `Apex OS attendance report ${metadata.month}; generated at ${metadata.generatedAt.toISOString()}; ${metadata.provisional ? 'provisional' : 'final for the month'}`,
  );
}
