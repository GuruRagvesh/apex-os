/**
 * Administrator attendance export: exactly two sheets, exactly 26 and 19 columns, and honest about what is unknown.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  DAILY_COLUMNS, SUMMARY_COLUMNS, HISTORICAL_RECOVERY_REASON, SOURCE_RECOVERY, SOURCE_APEX, SOURCE_SESSION_ONLY,
  buildAdminWorkbook, dailyRow, fiscalYearContext, gatherAdminDays, summaryRow, type AdminDay, type AdminEmployee,
} from '../../src/modules/platform/attendance/reports/attendance-admin-export';
import type { DayFacts } from '../../src/modules/platform/attendance/reports/payroll-aggregation';

const TZ = 'Asia/Kolkata';
const emp = (over: Partial<AdminEmployee> = {}): AdminEmployee => ({ id: 'u1', employeeId: 'OWN0024', name: 'Charu Kadam', department: 'Sales', designation: 'Executive', employeeType: 'Full-time', ...over });
const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
  userId: 'u1', date: '2026-04-03', status: 'PRESENT', evaluationState: 'FINALIZED', punchInAt: '2026-04-03T04:43:00.000Z', punchOutAt: '2026-04-03T13:37:00.000Z',
  punchInSource: null, punchOutSource: null, workedMinutes: 535, breakMinutes: 0, lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0, leaveType: null,
  exceptionFlags: [], regularizationId: null, viaManualRecovery: false, sessionSpanMinutes: null, ...over,
});
const recovered = (over: Partial<DayFacts> = {}, e = emp()): AdminDay => ({ employee: e, facts: facts(over), calculationReason: HISTORICAL_RECOVERY_REASON, origin: 'DAILY' });
const native = (over: Partial<DayFacts> = {}, e = emp()): AdminDay => ({ employee: e, facts: facts({ evaluationState: 'CALCULATED', breakMinutes: 45, lateMinutes: 12, ...over }), calculationReason: 'COMPLETE_WORKDAY', origin: 'DAILY' });
const col = (name: (typeof DAILY_COLUMNS)[number]) => DAILY_COLUMNS.indexOf(name);

describe('column contracts', () => {
  it('the daily sheet has EXACTLY the 26 agreed columns, in order', () => {
    expect([...DAILY_COLUMNS]).toEqual([
      'Employee Name', 'Employee ID', 'Department', 'Designation', 'Employee Type', 'Date', 'Attendance Status', 'Present', 'Absent', 'Half Day', 'Leave',
      'Punch In', 'Punch Out', 'Total Presence Time', 'Hours Worked', 'Break Time', 'Late Arrival', '9-Hour Completion / Shortfall', 'Leave Type',
      'Leave Deducted', 'LWP / Unpaid Portion', 'Comp Off', 'Manual Correction / Regularization', 'Missing Punch', 'Remarks / Exception', 'Data Source',
    ]);
    expect(DAILY_COLUMNS).toHaveLength(26);
    expect(dailyRow(recovered(), TZ)).toHaveLength(26);
  });

  it('the summary sheet has EXACTLY the 19 agreed columns, in order', () => {
    expect([...SUMMARY_COLUMNS]).toEqual([
      'Employee Name', 'Employee ID', 'Department', 'Designation', 'Employee Type', 'Working Days', 'Present Days', 'Absent Days', 'Half Days', 'Leave Days',
      'Late Days', 'Days Below 9 Hours', 'Total Presence Hours', 'Total Work Hours', 'Total Break Hours', 'CL Used', 'LWP / Unpaid Days', 'Attendance Deductions', 'Unresolved Days',
    ]);
    expect(SUMMARY_COLUMNS).toHaveLength(19);
    expect(summaryRow(emp(), [recovered()])).toHaveLength(19);
  });

  it('the workbook has EXACTLY two sheets with the agreed formatting', () => {
    const wb = buildAdminWorkbook({ periodLabel: 'Apr-Aug 2026', days: [recovered(), native({ date: '2026-08-28' })], timezone: TZ });
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Apr-Aug 2026 Daily Attendance', 'Employee Monthly Summary']);
    expect(wb.worksheets).toHaveLength(2);
    const [daily, summary] = wb.worksheets;
    expect(daily.getRow(1).values).toEqual([undefined, ...DAILY_COLUMNS]);
    expect(summary.getRow(1).values).toEqual([undefined, ...SUMMARY_COLUMNS]);
    expect(daily.autoFilter).toEqual({ from: { row: 1, column: 1 }, to: { row: 1, column: 26 } }); // A1:Z1
    expect(summary.autoFilter).toEqual({ from: { row: 1, column: 1 }, to: { row: 1, column: 19 } }); // A1:S1
    for (const ws of wb.worksheets) {
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.getRow(1).font?.bold).toBe(true);
      expect((ws.getRow(1).fill as any).fgColor.argb).toBe('FFF1F5F9');
    }
    // precomputed values only: no formula cells anywhere
    for (const ws of wb.worksheets) ws.eachRow((r) => r.eachCell((c) => expect(typeof c.value === 'object' && c.value !== null && 'formula' in (c.value as any)).toBe(false)));
  });
});

describe('financial year (April to March)', () => {
  it('April 2026 is fiscal month 1 of FY 2026-27 and August is month 5', () => {
    const fy = fiscalYearContext('2026-04-01', '2026-08-31');
    expect(fy).toMatchObject({ label: '2026-27', startYear: 2026, endYear: 2027, firstFiscalMonth: 1, lastFiscalMonth: 5 });
    expect(fy.text).toBe('FY 2026-27 (Apr 2026 - Mar 2027); this report covers fiscal months 1-5 (Apr 2026 - Aug 2026)');
  });

  it('January to March 2027 still belong to FY 2026-27 (months 10-12), not to a January-December year', () => {
    expect(fiscalYearContext('2027-01-01', '2027-03-31')).toMatchObject({ label: '2026-27', firstFiscalMonth: 10, lastFiscalMonth: 12 });
    expect(fiscalYearContext('2026-03-01', '2026-03-31').label).toBe('2025-26');
  });

  it('refuses a range that spans two financial years instead of mislabelling it', () => {
    expect(() => fiscalYearContext('2026-03-01', '2026-04-30')).toThrow(/two financial years/);
  });

  it('puts the context in the document properties and leaves the two sheets and their columns untouched', () => {
    const fy = fiscalYearContext('2026-04-01', '2026-08-31');
    const wb = buildAdminWorkbook({ periodLabel: 'Apr-Aug 2026', days: [recovered()], timezone: TZ, financialYear: fy });
    expect(wb.subject).toContain('FY 2026-27');
    expect(wb.worksheets).toHaveLength(2);
    expect(wb.worksheets[0].getRow(1).values).toEqual([undefined, ...DAILY_COLUMNS]);
    expect(wb.worksheets[1].getRow(1).values).toEqual([undefined, ...SUMMARY_COLUMNS]);
  });
});

describe('sheet naming', () => {
  it('refuses a name Excel would silently mangle, instead of truncating it', () => {
    expect(() => buildAdminWorkbook({ periodLabel: 'April-August 2026', days: [recovered()], timezone: TZ })).toThrow(/31/);
  });
});

describe('a recovered historical day', () => {
  it('shows the real punches in company time, the source data label, and no false zeros', () => {
    const r = dailyRow(recovered(), TZ);
    expect(r[col('Punch In')]).toBe('10:13');
    expect(r[col('Punch Out')]).toBe('19:07');
    expect(r[col('Total Presence Time')]).toBe('8:54');
    expect(r[col('Hours Worked')]).toBe('8:55');
    expect(r[col('Break Time')]).toBe('Not recorded'); // never 0:00
    expect(r[col('Late Arrival')]).toBe('Not assessed'); // never "on time"
    expect(r[col('9-Hour Completion / Shortfall')]).toBe('Short by 0:06');
    expect(r[col('Missing Punch')]).toBe('No');
    expect(r[col('Data Source')]).toBe(SOURCE_RECOVERY);
    expect(r[col('Present')]).toBe(1);
    expect(String(r[col('Remarks / Exception')])).toContain('break time and lateness were not recorded');
  });

  it('a one-punch day keeps its punch, is Missing Punch, and measures nothing it cannot', () => {
    const r = dailyRow(recovered({ punchOutAt: null, workedMinutes: 0, evaluationState: 'NEEDS_REVIEW', exceptionFlags: ['MISSING_PUNCH'] }), TZ);
    expect(r[col('Punch In')]).toBe('10:13');
    expect(r[col('Punch Out')]).toBe('');
    expect(r[col('Total Presence Time')]).toBe('Not calculable');
    expect(r[col('Hours Worked')]).toBe('Not calculable');
    expect(r[col('9-Hour Completion / Shortfall')]).toBe('Not calculable');
    expect(r[col('Missing Punch')]).toBe('Yes');
    expect(String(r[col('Remarks / Exception')])).toContain('one punch only');
  });

  it('a day Apex recorded itself still prints real break and late figures', () => {
    const r = dailyRow(native(), TZ);
    expect(r[col('Break Time')]).toBe('0:45');
    expect(r[col('Late Arrival')]).toBe('0:12');
    expect(r[col('Data Source')]).toBe(SOURCE_APEX);
  });
});

describe('days Apex holds only as a work session', () => {
  const session: AdminDay = { employee: emp(), calculationReason: null, origin: 'SESSION_ONLY', facts: facts({ status: 'UNRESOLVED', evaluationState: 'NOT_EVALUATED', workedMinutes: 500, breakMinutes: 40 }) };
  it('are UNRESOLVED with the real session facts, never Absent and never replaced', () => {
    const r = dailyRow(session, TZ);
    expect(r[col('Attendance Status')]).toBe('UNRESOLVED');
    expect([r[col('Present')], r[col('Absent')], r[col('Half Day')], r[col('Leave')]]).toEqual([0, 0, 0, 0]);
    expect(r[col('Break Time')]).toBe('0:40'); // a real Apex figure
    expect(r[col('Data Source')]).toBe(SOURCE_SESSION_ONLY);
    expect(String(r[col('Remarks / Exception')])).toContain('no evaluated attendance record');
  });
  it('count as unresolved in the monthly summary', () => {
    expect(summaryRow(emp(), [session, recovered()])[SUMMARY_COLUMNS.indexOf('Unresolved Days')]).toBe(1);
  });
});

describe('the monthly summary', () => {
  const at = (n: string) => SUMMARY_COLUMNS.indexOf(n as any);
  it('does not turn unknown into zero for a fully recovered employee', () => {
    const r = summaryRow(emp(), [recovered(), recovered({ date: '2026-04-06' })]);
    expect(r[at('Late Days')]).toBe('Not assessed');
    expect(r[at('Total Break Hours')]).toBe('Not recorded');
    expect(r[at('Present Days')]).toBe(2);
    expect(r[at('Total Presence Hours')]).toBe(17.8);
  });
  it('counts one-punch days as unresolved and excludes them from presence', () => {
    const r = summaryRow(emp(), [recovered(), recovered({ date: '2026-04-06', punchOutAt: null, workedMinutes: 0, evaluationState: 'NEEDS_REVIEW', exceptionFlags: ['MISSING_PUNCH'] })]);
    expect(r[at('Unresolved Days')]).toBe(1);
    expect(r[at('Total Presence Hours')]).toBe(8.9);
    expect(r[at('Days Below 9 Hours')]).toBe(1);
  });
  it('prints real late and break numbers when Apex recorded them', () => {
    const r = summaryRow(emp(), [native(), native({ date: '2026-08-31', lateMinutes: 0 })]);
    expect(r[at('Late Days')]).toBe(1);
    expect(r[at('Total Break Hours')]).toBe(1.5);
  });
});

describe('gathering (read-only)', () => {
  const rows: Record<string, any[]> = {
    dailyAttendance: [{ userId: 'u-former', date: new Date('2026-05-04T00:00:00Z'), status: 'PRESENT', evaluationState: 'FINALIZED', punchInAt: new Date('2026-05-04T04:30:00Z'), punchOutAt: new Date('2026-05-04T13:30:00Z'), workedMinutes: 540, breakMinutes: 0, lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0, calculationReason: HISTORICAL_RECOVERY_REASON, exceptionFlags: [], lastRegularizationId: null, leaveRequestId: null }],
    workSession: [{ userId: 'u-live', date: new Date('2026-05-05T00:00:00Z'), loginAt: new Date('2026-05-05T04:00:00Z'), startWorkAt: new Date('2026-05-05T04:00:00Z'), logoutAt: new Date('2026-05-05T13:00:00Z'), totalWorkMinutes: 500, totalBreakMinutes: 40 },
      { userId: 'u-former', date: new Date('2026-05-04T00:00:00Z'), loginAt: new Date('2026-05-04T04:00:00Z'), startWorkAt: null, logoutAt: null, totalWorkMinutes: 0, totalBreakMinutes: 0 }],
    user: [{ id: 'u-former', name: 'Former Person', employeeId: 'OWN0018', departmentId: null, designation: null, employmentType: 'Full-time' }, { id: 'u-live', name: 'Live Person', employeeId: 'OWN0024', departmentId: 'd1', designation: 'Exec', employmentType: 'Full-time' }],
    department: [{ id: 'd1', name: 'Sales' }], attendanceRegularization: [], leaveRequest: [],
  };
  const seen: string[] = [];
  const db = { findMany: async (model: string, args: any) => { seen.push(model); expect(Object.keys(args.select).length).toBeGreaterThan(0); expect(JSON.stringify(args.where ?? {})).not.toContain('isActive'); return rows[model] ?? []; } };

  it('includes a former (inactive) employee, adds a session-only day, and does not double-count a day that has a record', async () => {
    const days = await gatherAdminDays(db, '2026-04-01', '2026-08-31');
    expect(days.filter((d) => d.origin === 'DAILY')).toHaveLength(1);
    expect(days.find((d) => d.origin === 'DAILY')!.employee.name).toBe('Former Person');
    const sessionOnly = days.filter((d) => d.origin === 'SESSION_ONLY');
    expect(sessionOnly.map((d) => d.employee.name)).toEqual(['Live Person']); // the former person's session day already has a record
    expect(seen.every((m) => ['dailyAttendance', 'workSession', 'user', 'department', 'attendanceRegularization', 'leaveRequest'].includes(m))).toBe(true);
  });

  it('the module contains no write call', () => {
    const c = fs.readFileSync(path.join(__dirname, '../../src/modules/platform/attendance/reports/attendance-admin-export.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(c.match(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|\$queryRaw|\$transaction/)).toBeNull();
  });
});
