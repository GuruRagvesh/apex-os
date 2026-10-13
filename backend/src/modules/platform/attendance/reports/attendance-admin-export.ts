import * as ExcelJS from 'exceljs';
import { formatInTimeZone } from 'date-fns-tz';
import { presenceMinutes, summarise, toRegisterRow, type DayFacts, type EmployeeMeta } from './payroll-aggregation';

/**
 * Administrator attendance export: ONE workbook, EXACTLY two sheets.
 *
 *   Sheet 1  "<period> Daily Attendance"   exactly 26 columns, in this order
 *   Sheet 2  "Employee Monthly Summary"    exactly 19 columns, in this order
 *
 * Built on the EXISTING aggregation (summarise / toRegisterRow / presenceMinutes):
 * there is no second attendance calculation here, only presentation of what those
 * already compute plus three honest conventions:
 *
 *   - A recovered historical day (calculationReason HISTORICAL_RECOVERY_IMPORT) has
 *     no break data and no shift-assessed lateness. Its stored 0 means "not
 *     recorded" / "not assessed", and is PRINTED that way. A 0 is never shown as
 *     "no break" or "on time".
 *   - A day with exactly one punch has no presence span and no reliable worked
 *     time: both read "Not calculable", and the day counts as unresolved.
 *   - A day on which Apex holds a work session but no evaluated attendance record
 *     is shown as UNRESOLVED with the real session facts, never as Absent and never
 *     replaced by an external source.
 *
 * Pure: it formats rows it is handed. The gatherer below only READS (findMany).
 */

export const HISTORICAL_RECOVERY_REASON = 'HISTORICAL_RECOVERY_IMPORT';
export const REQUIRED_PRESENCE_MINUTES = 540;
/** Excel's hard limit on a worksheet name. */
export const MAX_SHEET_NAME = 31;
export const SOURCE_APEX = 'Apex OS';
export const SOURCE_RECOVERY = 'SalaryBox Historical Recovery';
export const SOURCE_SESSION_ONLY = 'Apex OS (work session, not evaluated)';

export const DAILY_COLUMNS = [
  'Employee Name', 'Employee ID', 'Department', 'Designation', 'Employee Type', 'Date', 'Attendance Status',
  'Present', 'Absent', 'Half Day', 'Leave', 'Punch In', 'Punch Out', 'Total Presence Time', 'Hours Worked',
  'Break Time', 'Late Arrival', '9-Hour Completion / Shortfall', 'Leave Type', 'Leave Deducted',
  'LWP / Unpaid Portion', 'Comp Off', 'Manual Correction / Regularization', 'Missing Punch',
  'Remarks / Exception', 'Data Source',
] as const;

export const SUMMARY_COLUMNS = [
  'Employee Name', 'Employee ID', 'Department', 'Designation', 'Employee Type', 'Working Days', 'Present Days',
  'Absent Days', 'Half Days', 'Leave Days', 'Late Days', 'Days Below 9 Hours', 'Total Presence Hours',
  'Total Work Hours', 'Total Break Hours', 'CL Used', 'LWP / Unpaid Days', 'Attendance Deductions', 'Unresolved Days',
] as const;

export interface AdminEmployee extends EmployeeMeta {
  designation: string | null;
  employeeType: string | null;
}

/** One employee-day for the export. */
export interface AdminDay {
  employee: AdminEmployee;
  facts: DayFacts;
  /** DailyAttendance.calculationReason (the recovery marker lives here). */
  calculationReason: string | null;
  /** Where this day's facts come from. */
  origin: 'DAILY' | 'SESSION_ONLY';
}

const PRESENT = new Set(['PRESENT', 'LATE', 'LATE_EXEMPTED']);
const hm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
const isRecovered = (d: AdminDay) => d.calculationReason === HISTORICAL_RECOVERY_REASON;
const exactlyOnePunch = (f: DayFacts) => (f.punchInAt === null) !== (f.punchOutAt === null);
const clock = (iso: string | null, tz: string) => (iso ? formatInTimeZone(new Date(iso), tz, 'HH:mm') : '');
/** A non-working day (company holiday / weekly off): no presence, hours, break or lateness are expected. */
const isOffDay = (d: AdminDay) => d.origin === 'DAILY' && (d.facts.status === 'HOLIDAY' || d.facts.status === 'WEEKLY_OFF') && d.facts.punchInAt === null && d.facts.punchOutAt === null;
/** Presence the register would compute, or null when it cannot be measured (or none is expected). */
const presenceOf = (d: AdminDay): number | null => (exactlyOnePunch(d.facts) || isOffDay(d) ? null : presenceMinutes(d.facts));

export function dailyRow(d: AdminDay, tz: string): Array<string | number> {
  const f = d.facts;
  const reg = toRegisterRow(d.employee, f, REQUIRED_PRESENCE_MINUTES);
  const presence = presenceOf(d);
  const recovered = isRecovered(d);
  const sessionOnly = d.origin === 'SESSION_ONLY';
  const one = exactlyOnePunch(f);
  const status = sessionOnly ? 'UNRESOLVED' : f.status;
  const off = isOffDay(d);

  const remarks: string[] = [];
  if (sessionOnly) remarks.push('Apex work session recorded; no evaluated attendance record');
  else if (off) remarks.push(`${f.status === 'HOLIDAY' ? 'Company holiday' : 'Weekly off'}${recovered ? ' (recovered from SalaryBox history)' : ''}`);
  else {
    if (recovered) remarks.push('Recovered from SalaryBox history; break time and lateness were not recorded');
    if (f.evaluationState === 'NEEDS_REVIEW') remarks.push('Needs review');
    if (one) remarks.push('Presence cannot be calculated (one punch only)');
    if (reg.remarks && !recovered && !one && f.evaluationState !== 'NEEDS_REVIEW') remarks.push(reg.remarks);
  }

  return [
    d.employee.name, d.employee.employeeId ?? '', d.employee.department ?? '', d.employee.designation ?? '', d.employee.employeeType ?? '',
    f.date, status,
    sessionOnly ? 0 : PRESENT.has(f.status) ? 1 : 0,
    sessionOnly ? 0 : f.status === 'ABSENT' ? 1 : 0,
    sessionOnly ? 0 : f.status === 'HALF_DAY' ? 1 : 0,
    sessionOnly ? 0 : f.status === 'LEAVE' || f.status === 'LWP' ? 1 : 0,
    clock(f.punchInAt, tz), clock(f.punchOutAt, tz),
    off ? '' : presence === null ? 'Not calculable' : hm(presence),
    off ? '' : one ? 'Not calculable' : hm(f.workedMinutes),
    off ? '' : recovered ? 'Not recorded' : hm(f.breakMinutes),
    off ? '' : recovered ? 'Not assessed' : hm(f.lateMinutes),
    off ? '' : presence === null ? 'Not calculable' : presence >= REQUIRED_PRESENCE_MINUTES ? 'Complete' : `Short by ${hm(REQUIRED_PRESENCE_MINUTES - presence)}`,
    f.leaveType ?? '', f.leaveDeducted, f.lwpDeducted, f.leaveType === 'COMP_OFF' ? 'Yes' : '',
    f.viaManualRecovery ? 'Manual recovery' : f.regularizationId ? 'Corrected' : '',
    one || f.exceptionFlags.includes('MISSING_PUNCH') ? 'Yes' : 'No',
    remarks.join('; '),
    sessionOnly ? SOURCE_SESSION_ONLY : recovered ? SOURCE_RECOVERY : SOURCE_APEX,
  ];
}

export function summaryRow(employee: AdminEmployee, days: AdminDay[]): Array<string | number> {
  const facts = days.map((d) => d.facts);
  const daily = days.filter((d) => d.origin === 'DAILY');
  const s = summarise(employee, daily.map((d) => d.facts));
  const allRecovered = daily.length > 0 && daily.every(isRecovered);
  const native = daily.filter((d) => !isRecovered(d));
  const presenceKnown = daily.map(presenceOf).filter((p): p is number => p !== null);
  const unresolved = days.filter((d) => d.origin === 'SESSION_ONLY' || d.facts.evaluationState === 'NEEDS_REVIEW' || d.facts.evaluationState === 'NOT_EVALUATED' || exactlyOnePunch(d.facts)).length;
  const lateNative = native.filter((d) => d.facts.lateMinutes > 0).length;

  return [
    employee.name, employee.employeeId ?? '', employee.department ?? '', employee.designation ?? '', employee.employeeType ?? '',
    s.workingDays, s.present, s.absent, s.halfDays,
    daily.filter((d) => d.facts.status === 'LEAVE' || d.facts.status === 'LWP').length,
    allRecovered ? 'Not assessed' : lateNative,
    presenceKnown.filter((p) => p < REQUIRED_PRESENCE_MINUTES).length,
    Math.round((presenceKnown.reduce((n, p) => n + p, 0) / 60) * 10) / 10,
    Math.round((daily.filter((d) => !exactlyOnePunch(d.facts)).reduce((n, d) => n + d.facts.workedMinutes, 0) / 60) * 10) / 10,
    allRecovered ? 'Not recorded' : Math.round((native.reduce((n, d) => n + d.facts.breakMinutes, 0) / 60) * 10) / 10,
    s.casualLeave,
    facts.reduce((n, f) => n + f.lwpDeducted, 0),
    facts.reduce((n, f) => n + f.leaveDeducted + f.lwpDeducted, 0),
    unresolved,
  ];
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

function styled(ws: ExcelJS.Worksheet, columns: readonly string[], rows: Array<Array<string | number>>, widths: Record<string, number>) {
  ws.columns = columns.map((c) => ({ header: c, width: widths[c] ?? 16 }));
  rows.forEach((r) => ws.addRow(r));
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2' }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Financial-year context for a business-date range. The company FY starts in APRIL (startMonth 4, the same
 * default TVAService.financialYearStartMonth() uses), so April 2026 is fiscal month 1 of FY 2026-27 and the
 * year runs to 31 March 2027. Pure: no clock, no I/O.
 */
export function fiscalYearContext(from: string, to: string, startMonth = 4): { label: string; startYear: number; endYear: number; firstFiscalMonth: number; lastFiscalMonth: number; text: string } {
  const parse = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) });
  const a = parse(from), b = parse(to);
  const fyStart = (p: { y: number; m: number }) => (p.m >= startMonth ? p.y : p.y - 1);
  const fyA = fyStart(a);
  if (fyA !== fyStart(b)) throw new Error(`Range ${from}..${to} spans two financial years`);
  const fiscalMonth = (p: { m: number }) => ((p.m - startMonth + 12) % 12) + 1;
  const endMonthIdx = (startMonth + 10) % 12; // 0-based index of the last fiscal month (March for April starts)
  const label = `${fyA}-${String(fyA + 1).slice(2)}`;
  const text = `FY ${label} (${MONTH_ABBR[startMonth - 1]} ${fyA} - ${MONTH_ABBR[endMonthIdx]} ${fyA + 1}); this report covers fiscal months ${fiscalMonth(a)}-${fiscalMonth(b)} (${MONTH_ABBR[a.m - 1]} ${a.y} - ${MONTH_ABBR[b.m - 1]} ${b.y})`;
  return { label, startYear: fyA, endYear: fyA + 1, firstFiscalMonth: fiscalMonth(a), lastFiscalMonth: fiscalMonth(b), text };
}

export function buildAdminWorkbook(input: { periodLabel: string; days: AdminDay[]; timezone: string; financialYear?: { text: string } }): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apex OS Attendance';
  wb.created = new Date(0); // pinned: the same input produces the same bytes
  wb.modified = new Date(0);
  // The two sheets keep their approved column contracts (26 and 19); financial-year context lives in the document properties.
  if (input.financialYear) { wb.title = `Attendance - ${input.periodLabel}`; wb.subject = input.financialYear.text; wb.description = input.financialYear.text; }

  const ordered = [...input.days].sort((a, b) => a.employee.name.localeCompare(b.employee.name) || a.facts.date.localeCompare(b.facts.date));
  // Excel refuses a sheet name over 31 characters. Truncating would silently publish a mangled name, so a
  // label that does not fit is an error the caller must fix (e.g. "Apr-Aug 2026", not "April-August 2026").
  const dailyName = `${input.periodLabel} Daily Attendance`;
  if (dailyName.length > MAX_SHEET_NAME) throw new Error(`Sheet name "${dailyName}" is ${dailyName.length} characters; Excel allows ${MAX_SHEET_NAME}. Use a shorter period label.`);
  styled(wb.addWorksheet(dailyName), DAILY_COLUMNS, ordered.map((d) => dailyRow(d, input.timezone)), {
    'Employee Name': 24, 'Employee ID': 12, Department: 18, Designation: 20, 'Employee Type': 14, Date: 12, 'Attendance Status': 15,
    'Punch In': 10, 'Punch Out': 10, 'Total Presence Time': 14, 'Hours Worked': 13, 'Break Time': 13, 'Late Arrival': 13,
    '9-Hour Completion / Shortfall': 22, 'Manual Correction / Regularization': 22, 'Remarks / Exception': 60, 'Data Source': 34,
  });

  const byEmployee = new Map<string, { employee: AdminEmployee; days: AdminDay[] }>();
  for (const d of ordered) {
    const slot = byEmployee.get(d.employee.id) ?? { employee: d.employee, days: [] };
    slot.days.push(d);
    byEmployee.set(d.employee.id, slot);
  }
  const summaries = [...byEmployee.values()].map((e) => summaryRow(e.employee, e.days));
  styled(wb.addWorksheet('Employee Monthly Summary'), SUMMARY_COLUMNS, summaries, { 'Employee Name': 24, 'Employee ID': 12, Department: 18, Designation: 20, 'Employee Type': 14 });
  return wb;
}

// ───────────────────────────────────────────────────────────────────────────
// Gathering. READ-ONLY: findMany with explicit columns, nothing else.
// ───────────────────────────────────────────────────────────────────────────

export interface ReadOnlyFindMany {
  findMany(model: string, args: { select: Record<string, true>; where?: Record<string, unknown> }): Promise<any[]>;
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d));
const day = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const col = (...n: string[]) => Object.fromEntries(n.map((k) => [k, true])) as Record<string, true>;

/**
 * Every employee-day in [from, to]: all DailyAttendance rows (INCLUDING users who
 * are inactive now: a former employee's history is still history) plus a
 * SESSION_ONLY entry for each day Apex holds a work session but no evaluated record.
 */
export async function gatherAdminDays(db: ReadOnlyFindMany, from: string, to: string): Promise<AdminDay[]> {
  const range = { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) };
  const [records, sessions, users, departments, regs, leaves] = await Promise.all([
    db.findMany('dailyAttendance', { select: col('userId', 'date', 'status', 'evaluationState', 'punchInAt', 'punchOutAt', 'workedMinutes', 'breakMinutes', 'lateMinutes', 'leaveDeducted', 'lwpDeducted', 'calculationReason', 'exceptionFlags', 'lastRegularizationId', 'leaveRequestId'), where: { date: range } }),
    db.findMany('workSession', { select: col('userId', 'date', 'loginAt', 'startWorkAt', 'logoutAt', 'totalWorkMinutes', 'totalBreakMinutes'), where: { date: range } }),
    db.findMany('user', { select: col('id', 'name', 'employeeId', 'departmentId', 'designation', 'employmentType') }),
    db.findMany('department', { select: col('id', 'name') }),
    db.findMany('attendanceRegularization', { select: col('id', 'entrySource'), where: { date: range } }),
    db.findMany('leaveRequest', { select: col('id', 'type') }),
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name as string]));
  const emp = new Map<string, AdminEmployee>(users.map((u) => [u.id, { id: u.id, employeeId: u.employeeId ?? null, name: u.name, department: u.departmentId ? (deptName.get(u.departmentId) ?? null) : null, designation: u.designation ?? null, employeeType: u.employmentType ?? null }]));
  const recoveryIds = new Set(regs.filter((r) => r.entrySource === 'MANUAL_RECOVERY').map((r) => r.id));
  const leaveType = new Map(leaves.map((l) => [l.id, String(l.type)]));

  const out: AdminDay[] = [];
  const haveRecord = new Set<string>();
  for (const r of records) {
    const e = emp.get(r.userId);
    if (!e) continue;
    const date = day(r.date);
    haveRecord.add(`${r.userId}|${date}`);
    out.push({
      employee: e, calculationReason: r.calculationReason ?? null, origin: 'DAILY',
      facts: {
        userId: r.userId, date, status: r.status, evaluationState: r.evaluationState,
        punchInAt: r.punchInAt ? iso(r.punchInAt) : null, punchOutAt: r.punchOutAt ? iso(r.punchOutAt) : null,
        punchInSource: null, punchOutSource: null, workedMinutes: r.workedMinutes, breakMinutes: r.breakMinutes, lateMinutes: r.lateMinutes,
        leaveDeducted: r.leaveDeducted, lwpDeducted: r.lwpDeducted, leaveType: r.leaveRequestId ? (leaveType.get(r.leaveRequestId) ?? null) : null,
        exceptionFlags: r.exceptionFlags ?? [], regularizationId: r.lastRegularizationId ?? null,
        viaManualRecovery: r.lastRegularizationId ? recoveryIds.has(r.lastRegularizationId) : false, sessionSpanMinutes: null,
      },
    });
  }
  const sessionDays = new Map<string, any[]>();
  for (const s of sessions) {
    const k = `${s.userId}|${day(s.date)}`;
    if (haveRecord.has(k)) continue;
    sessionDays.set(k, [...(sessionDays.get(k) ?? []), s]);
  }
  for (const [k, ss] of sessionDays) {
    const [userId, date] = k.split('|');
    const e = emp.get(userId);
    if (!e) continue;
    const starts = ss.map((s) => s.startWorkAt ?? s.loginAt).filter(Boolean).map((d: Date) => new Date(d).getTime()).sort((a: number, b: number) => a - b);
    const ends = ss.map((s) => s.logoutAt).filter(Boolean).map((d: Date) => new Date(d).getTime()).sort((a: number, b: number) => a - b);
    out.push({
      employee: e, calculationReason: null, origin: 'SESSION_ONLY',
      facts: {
        userId, date, status: 'UNRESOLVED', evaluationState: 'NOT_EVALUATED',
        punchInAt: starts.length ? new Date(starts[0]).toISOString() : null, punchOutAt: ends.length ? new Date(ends[ends.length - 1]).toISOString() : null,
        punchInSource: null, punchOutSource: null, workedMinutes: ss.reduce((n, s) => n + (s.totalWorkMinutes ?? 0), 0), breakMinutes: ss.reduce((n, s) => n + (s.totalBreakMinutes ?? 0), 0),
        lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0, leaveType: null, exceptionFlags: [], regularizationId: null, viaManualRecovery: false, sessionSpanMinutes: null,
      },
    });
  }
  return out;
}
