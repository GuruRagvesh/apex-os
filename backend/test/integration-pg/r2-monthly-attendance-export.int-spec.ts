/**
 * The monthly attendance report against a real PostgreSQL server.
 *
 * Real Prisma, real triggers, real locks, the real evaluator. Proves, end to
 * end, that a correction's lifecycle reaches the official day, the on-screen
 * Monthly Register, the Excel workbook and the CSV package together -- and that
 * an approval that cannot be applied changes nothing official:
 *
 *   - approved status correction: official day revised, audited before/after,
 *     reflected on screen and in both files; an earlier download is unchanged
 *   - pending, rejected, held (leave day, finalized month) and stale outcomes
 *   - a granted status the evaluator cannot settle rolls back and is held
 *   - scope: a manager sees their reports only; an employee is refused; a
 *     department filter cannot widen a manager's scope
 *   - the screen, the workbook and the CSV agree on the real database
 */

import * as ExcelJS from 'exceljs';
import { buildHarness, Harness, seedCompany, Seed, givenAttendance, givenApprovedLeave, DATE, MONTH } from './harness';
import { TVAService } from '../../src/common/services/tva.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { CorrectionAuthorityService } from '../../src/modules/platform/attendance/regularization/correction-authority.service';
import { CorrectionDecisionService } from '../../src/modules/platform/attendance/regularization/correction-decision.service';
import { BusinessCalendarService } from '../../src/modules/platform/attendance/calendar/business-calendar.service';
import { AttendanceConsoleService } from '../../src/modules/platform/attendance/console/attendance-console.service';
import { MonthlyAttendanceReportService } from '../../src/modules/platform/attendance/console/export/monthly-attendance-report.service';
import { MONTHLY_COLUMNS, MONTHLY_SHEET_NAME, DAILY_COLUMNS, DAILY_SHEET_NAME } from '../../src/modules/platform/attendance/console/export/report-columns';
import { FIRST_DATA_ROW } from '../../src/modules/platform/attendance/console/export/report-workbook';
import { monthlyCsvName } from '../../src/modules/platform/attendance/console/export/report-csv';

const JSZip = require('jszip');

const DAY = new Date(`${DATE}T00:00:00.000Z`);
const HR = { id: 'u-hr', role: { name: 'MANAGER' }, isHR: true };
const MANAGER = { id: 'u-mgr', role: { name: 'MANAGER' } };

describe('Monthly attendance report (PostgreSQL)', () => {
  let h: Harness;
  let seed: Seed;
  let decisions: CorrectionDecisionService;
  let reports: MonthlyAttendanceReportService;

  beforeAll(async () => {
    h = await buildHarness();
    const tva = h.moduleRef.get(TVAService);
    const access = h.moduleRef.get(AccessPolicyService);
    const events = h.moduleRef.get(EventLoggerService);
    const settings = { get: async () => ({ correctionDecisionEnabled: true, regularizationEnabled: true }) };
    decisions = new CorrectionDecisionService(h.prisma, tva, events, settings as any, h.evaluator, new CorrectionAuthorityService(h.prisma, access));
    const calendar = new BusinessCalendarService(h.prisma, tva);
    const consoleService = new AttendanceConsoleService(
      h.prisma,
      tva,
      access,
      { isApproverFor: async () => true } as any,
      events,
      h.evaluator,
      { blockedFromLastRun: async () => null } as any,
      calendar,
      { getLeaveBalance: async () => ({ balance: 5 }) } as any,
    );
    reports = new MonthlyAttendanceReportService(h.prisma, tva, consoleService, calendar, events, access);
  });
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    seed = await seedCompany(h.prisma);
    await h.prisma.user.create({ data: { id: 'u-mgr', employeeId: 'TE-952', email: 'mgr@integration.invalid', name: 'Manager', password: 'x', roleId: 'r-manager' } as any });
    await h.prisma.user.update({ where: { id: seed.employees.B.id }, data: { reportingManager: 'TE-952' } });
  });

  const B = () => seed.employees.B.id;

  /** An ABSENT official day with complete punches: what a status correction is for. */
  async function absentDay(fields: Record<string, any> = {}) {
    return givenAttendance(h.prisma, B(), DATE, { status: 'ABSENT', evaluationState: 'CALCULATED', calculationReason: 'NO_ATTENDANCE', ...fields });
  }

  async function statusRequest(basedOn: string | null) {
    return h.prisma.attendanceRegularization.create({
      data: {
        userId: B(),
        date: DAY,
        requestType: 'OTHER',
        policyCorrectionType: 'INCORRECT_ATTENDANCE_STATUS',
        reason: 'I was in the office all day; marked absent by mistake.',
        status: 'PENDING',
        basedOnFingerprint: basedOn,
      } as any,
    });
  }

  const dailyFor = (report: any, userId: string) => report.dailyRows.find((r: any) => r.userId === userId && r.businessDate === DATE).values;
  const summaryFor = (report: any, userId: string) => report.monthlySummaryRows.find((r: any) => r.userId === userId).values;

  async function excelDaily(buffer: Buffer, employeeName: string) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const sheet = wb.getWorksheet(DAILY_SHEET_NAME)!;
    const nameCol = DAILY_COLUMNS.findIndex((c) => c.key === 'employeeName') + 1;
    const dateCol = DAILY_COLUMNS.findIndex((c) => c.key === 'date') + 1;
    const statusCol = DAILY_COLUMNS.findIndex((c) => c.key === 'attendanceStatus') + 1;
    for (let r = FIRST_DATA_ROW; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const date = row.getCell(dateCol).value as Date;
      if (row.getCell(nameCol).value === employeeName && date.toISOString().slice(0, 10) === DATE) return String(row.getCell(statusCol).value);
    }
    return null;
  }

  it('an approved status correction revises the official day, is audited, and reaches the screen and both files', async () => {
    // Clean capture evidence: without a captured photo the evaluator keeps the
    // day in review, and the approval is (correctly) held instead.
    const evidence = async (type: 'PUNCH_IN' | 'PUNCH_OUT', at: Date) =>
      (await h.prisma.attendancePunchEvidence.create({
        data: { userId: B(), type, businessDate: DAY, serverOccurredAt: at, idempotencyKey: `r2-${type}`, photoVerification: 'CAPTURED', locationVerification: 'VERIFIED' } as any,
      })).id;
    const day = await absentDay({
      punchInEvidenceId: await evidence('PUNCH_IN', new Date(`${DATE}T04:05:00.000Z`)),
      punchOutEvidenceId: await evidence('PUNCH_OUT', new Date(`${DATE}T13:10:00.000Z`)),
    });
    const req = await statusRequest(day.sourceFingerprint);

    const before = await reports.build(HR, { month: MONTH });
    expect(dailyFor(before, B())).toMatchObject({ attendanceStatus: 'Absent', disputeStatus: 'Pending' });
    expect(summaryFor(before, B()).provisional).toBe('Yes');
    const oldDownload = await reports.export(HR, { month: MONTH }, 'xlsx');

    const decided: any = await decisions.decide('u-hr', req.id, { decision: 'APPROVE', reason: 'Badge records confirm attendance.', reviewedFingerprint: day.sourceFingerprint, grantedStatus: 'PRESENT' });
    expect(decided).toMatchObject({ status: 'APPROVED', applicationStatus: 'APPLIED', proposedStatus: 'PRESENT' });

    const official = await h.prisma.dailyAttendance.findUnique({ where: { userId_date: { userId: B(), date: DAY } } });
    expect(official).toMatchObject({ status: 'PRESENT', lastRegularizationId: req.id });
    expect(official!.revision).toBeGreaterThan(day.revision);

    const audit = await h.prisma.operationalEvent.findFirst({ where: { action: 'ATTENDANCE_OFFICIAL_REVISED', entityId: official!.id } });
    expect(audit).toMatchObject({ actorId: 'u-hr', fromState: 'ABSENT', toState: 'PRESENT' });
    expect((audit as any).beforeValue).toMatchObject({ status: 'ABSENT' });
    expect((audit as any).afterValue).toMatchObject({ status: 'PRESENT' });

    const after = await reports.build(HR, { month: MONTH });
    expect(dailyFor(after, B())).toMatchObject({ attendanceStatus: 'Present', disputeStatus: 'Approved - Applied', regularized: 'Yes' });
    const screen = await reports.register(HR, { month: MONTH });
    const onScreen = screen.employees.find((e: any) => e.userId === B())!;
    expect(onScreen.daysPresent).toBe(summaryFor(after, B()).presentDays);
    expect(onScreen.daysAbsent).toBe(0);

    // The new files say Present; the earlier download is a snapshot and still says Absent.
    const newDownload = await reports.export(HR, { month: MONTH }, 'xlsx');
    expect(await excelDaily(newDownload.buffer, 'Employee B')).toBe('Present');
    expect(await excelDaily(oldDownload.buffer, 'Employee B')).toBe('Absent');
    const zip = await JSZip.loadAsync((await reports.export(HR, { month: MONTH }, 'zip')).buffer);
    expect(Object.keys(zip.files).sort()).toEqual(['Daily_Attendance_August_2026.csv', 'Monthly_Summary_August_2026.csv']);
  });

  it('a granted status the evaluator cannot settle rolls back completely and is held', async () => {
    // No punch out: the evaluator keeps this day in review whatever is granted.
    const day = await absentDay({ punchOutAt: null, status: 'MISSING_PUNCH', evaluationState: 'NEEDS_REVIEW', exceptionFlags: ['MISSING_PUNCH_OUT'] });
    const req = await statusRequest(day.sourceFingerprint);
    const decided: any = await decisions.decide('u-hr', req.id, { decision: 'APPROVE', reason: 'Approve; the day needs its punch first.', reviewedFingerprint: day.sourceFingerprint, grantedStatus: 'PRESENT' });
    expect(decided).toMatchObject({ status: 'APPROVED', applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: 'STATUS_NEEDS_EVIDENCE' });

    const official = await h.prisma.dailyAttendance.findUnique({ where: { userId_date: { userId: B(), date: DAY } } });
    expect(official).toMatchObject({ status: day.status, revision: day.revision, sourceFingerprint: day.sourceFingerprint, lastRegularizationId: null });
    expect(await h.prisma.operationalEvent.count({ where: { action: 'ATTENDANCE_OFFICIAL_REVISED' } })).toBe(0);

    const report = await reports.build(HR, { month: MONTH });
    expect(dailyFor(report, B())).toMatchObject({ disputeStatus: 'Approved - Held (Not Applied)', hrReview: 'Approved Correction Held - HR to Apply' });
    expect(summaryFor(report, B()).provisional).toBe('Yes');
  });

  it('a status correction on an approved-leave day is held and the leave stays', async () => {
    const leave = await givenApprovedLeave(h.prisma, B(), DATE, DATE);
    const day = await givenAttendance(h.prisma, B(), DATE, { status: 'LEAVE', calculationReason: 'APPROVED_LEAVE', leaveRequestId: leave.id, punchInAt: null, punchOutAt: null });
    const req = await statusRequest(day.sourceFingerprint);
    const decided: any = await decisions.decide('u-hr', req.id, { decision: 'APPROVE', reason: 'Approve, leave workflow decides.', reviewedFingerprint: day.sourceFingerprint, grantedStatus: 'PRESENT' });
    expect(decided).toMatchObject({ applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: 'STATUS_NOT_CORRECTABLE' });
    const official = await h.prisma.dailyAttendance.findUnique({ where: { userId_date: { userId: B(), date: DAY } } });
    expect(official).toMatchObject({ status: 'LEAVE', revision: day.revision });
    expect(dailyFor(await reports.build(HR, { month: MONTH }), B()).attendanceStatus).toBe('Approved Leave');
  });

  it('a finalized month holds the approval and does not touch the day', async () => {
    const day = await absentDay();
    await h.prisma.attendanceMonthClose.create({ data: { month: MONTH, status: 'FINALIZED' } as any });
    const req = await statusRequest(day.sourceFingerprint);
    const decided: any = await decisions.decide('u-hr', req.id, { decision: 'APPROVE', reason: 'Valid, month is closed.', reviewedFingerprint: day.sourceFingerprint, grantedStatus: 'PRESENT' });
    expect(decided).toMatchObject({ applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: 'MONTH_FINALIZED' });
    const official = await h.prisma.dailyAttendance.findUnique({ where: { userId_date: { userId: B(), date: DAY } } });
    expect(official).toMatchObject({ status: 'ABSENT', revision: day.revision });
    // The decided fields, the granted status included, are immutable now.
    await expect(h.prisma.attendanceRegularization.update({ where: { id: req.id }, data: { proposedStatus: 'HALF_DAY' } })).rejects.toThrow();
  });

  it('rejected keeps the original values; stale is re-review; both visible in the report', async () => {
    const day = await absentDay();
    const req = await statusRequest(day.sourceFingerprint);
    await decisions.decide('u-hr', req.id, { decision: 'REJECT', reason: 'No evidence of attendance.' });
    let report = await reports.build(HR, { month: MONTH });
    expect(dailyFor(report, B())).toMatchObject({ attendanceStatus: 'Absent', disputeStatus: 'Rejected', regularized: 'No' });

    // A second employee: the day changed after the request was raised.
    const C = seed.employees.C.id;
    const dayC = await givenAttendance(h.prisma, C, DATE, { status: 'ABSENT', sourceFingerprint: 'fp-old' });
    const reqC = await h.prisma.attendanceRegularization.create({ data: { userId: C, date: DAY, requestType: 'OTHER', policyCorrectionType: 'INCORRECT_ATTENDANCE_STATUS', reason: 'Wrong status', status: 'PENDING', basedOnFingerprint: 'fp-old' } as any });
    await h.prisma.dailyAttendance.update({ where: { id: dayC.id }, data: { sourceFingerprint: 'fp-new' } });
    await expect(decisions.decide('u-hr', reqC.id, { decision: 'APPROVE', reason: 'Approve', reviewedFingerprint: 'fp-old', grantedStatus: 'PRESENT' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CORRECTION_STALE' }),
    });
    report = await reports.build(HR, { month: MONTH });
    expect(dailyFor(report, C)).toMatchObject({ attendanceStatus: 'Absent', disputeStatus: 'Stale - Requires Review', hrReview: 'Correction Stale - Re-review' });
    expect(summaryFor(report, C).provisional).toBe('Yes');
  });

  it('scope: a manager sees only their reports, an employee is refused, a department filter cannot widen', async () => {
    await absentDay();
    const mine = await reports.register(MANAGER, { month: MONTH });
    expect(mine.employees.map((e: any) => e.userId)).toEqual([B()]);
    expect((mine as any).devices).toBeUndefined();

    const employee = { id: seed.employees.A.id, role: { name: 'EMPLOYEE' } };
    await expect(reports.register(employee, { month: MONTH })).rejects.toMatchObject({ status: 403 });
    await expect(reports.export(employee, { month: MONTH }, 'xlsx')).rejects.toMatchObject({ status: 403 });
    await expect(reports.export(employee, { month: MONTH }, 'zip')).rejects.toMatchObject({ status: 403 });

    const dept = await h.prisma.department.upsert({ where: { name: 'Integration Sales' } as any, create: { name: 'Integration Sales' } as any, update: {} });
    await h.prisma.user.update({ where: { id: seed.employees.C.id }, data: { departmentId: dept.id } });
    const filtered = await reports.build(MANAGER, { month: MONTH, departmentId: dept.id });
    // C is in the department but not the manager's: still not visible.
    expect(filtered.monthlySummaryRows).toHaveLength(0);
  });

  it('the screen, the workbook and the CSV agree on the real database', async () => {
    await absentDay();
    await givenAttendance(h.prisma, seed.employees.C.id, DATE, { status: 'HALF_DAY', calculationReason: 'HALF_DAY' });
    const screen = await reports.register(HR, { month: MONTH });
    const xlsx = await reports.export(HR, { month: MONTH }, 'xlsx');
    const zip = await JSZip.loadAsync((await reports.export(HR, { month: MONTH }, 'zip')).buffer);
    const csv: string = await zip.file(monthlyCsvName('August 2026')).async('string');
    const csvRows = csv.slice(1).split('\r\n').filter(Boolean).map((l) => l.split(','));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.buffer as any);
    const sheet = wb.getWorksheet(MONTHLY_SHEET_NAME)!;
    const col = (k: string) => MONTHLY_COLUMNS.findIndex((c) => c.key === k);
    const nameAt = (r: number) => String(sheet.getRow(FIRST_DATA_ROW + r).getCell(col('employeeName') + 1).value);

    expect(screen.employees.map((e: any) => e.name)).toEqual(screen.employees.map((_: any, i: number) => nameAt(i)));
    screen.employees.forEach((e: any, i: number) => {
      const csvRow = csvRows[i + 1];
      expect(csvRow[col('presentDays')]).toBe(String(e.daysPresent));
      expect(csvRow[col('absentDays')]).toBe(String(e.daysAbsent));
      expect(csvRow[col('halfDays')]).toBe(String(e.halfDays));
      expect(csvRow[col('unresolvedDays')]).toBe(String(e.unresolvedDays));
      expect(csvRow[col('provisional')]).toBe(e.provisional ? 'Yes' : 'No');
      expect(csvRow[col('attendancePercent')]).toBe(e.attendanceCompletionPercentage === null ? '' : `${e.attendanceCompletionPercentage.toFixed(2)}%`);
    });
  });
});
