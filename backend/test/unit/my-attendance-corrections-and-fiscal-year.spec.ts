/**
 * My Attendance: recovered history, correction requests, the April-March year, and who a history report includes.
 *
 *   F1-F4   the financial year is April to March, from ONE backend definition
 *   R1-R5   a recovered historical day is shown as stored, honestly, and never replaces a native day
 *   C1-C8   correction requests: future dates, stored values, review-only OTHER, duplicates, RBAC
 *   L1-L14  monthly limits: one combined bucket of 10 punch corrections, a separate bucket of 4 status corrections
 *   H1-H4   history includes former employees who have records; operational views do not
 *   M1-M4   an older backend that sends no financial year does not break the page
 *   S1      the read surfaces write nothing
 */
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TVAService } from '../../src/common/services/tva.service';
import { financialYearV2, mapRecoveredDay, summarizeAttendanceDays, type StoredRecoveredDay } from '../../src/modules/platform/attendance/v2/my-attendance-v2.contract';
import { MyAttendanceV2Service } from '../../src/modules/platform/attendance/v2/my-attendance-v2.service';
import { PUNCH_CORRECTION_MONTHLY_LIMIT, RegularizationService, STATUS_CORRECTION_MONTHLY_LIMIT } from '../../src/modules/platform/attendance/regularization/regularization.service';
import { AttendanceConsoleService } from '../../src/modules/platform/attendance/console/attendance-console.service';
import { makeRawSqlDouble } from '../helpers/raw-sql-double';
import { usableFinancialYear } from '../../../frontend/components/attendance-v2/financial-year';

const tva = () => new TVAService({ get: () => undefined } as unknown as ConfigService);

// ── F: the financial year ────────────────────────────────────────────────────────────────────────────────────

describe('F financial year (April to March)', () => {
  it('F1. FY 2026-27 is April 2026 through March 2027, in order', () => {
    const fy = financialYearV2(2026, 4);
    expect(fy.months).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
    expect(fy).toMatchObject({ label: '2026-2027', startYear: 2026, endYear: 2027, startMonth: 4 });
  });

  it('F2. January to March 2027 belong to FY 2026-27, and January to March 2026 do not', () => {
    const fy = financialYearV2(2026, 4);
    for (const m of ['2027-01', '2027-02', '2027-03']) expect(fy.months).toContain(m);
    for (const m of ['2026-01', '2026-02', '2026-03']) expect(fy.months).not.toContain(m);
    expect(financialYearV2(2025, 4).months).toEqual(expect.arrayContaining(['2026-01', '2026-02', '2026-03']));
  });

  it('F3. the year is taken from the company definition: February 2026 is in FY 2025-26, April 2026 in FY 2026-27', () => {
    const t = tva();
    expect(t.financialYear(new Date('2026-02-01T12:00:00.000Z')).startYear).toBe(2025);
    expect(t.financialYear(new Date('2026-03-31T12:00:00.000Z')).startYear).toBe(2025);
    expect(t.financialYear(new Date('2026-04-01T12:00:00.000Z')).startYear).toBe(2026);
    expect(t.financialYear(new Date('2027-03-31T12:00:00.000Z')).startYear).toBe(2026);
  });

  it('F4. the overview carries the year of the REQUESTED month, built from that one definition', async () => {
    const prisma: any = { workSession: { findMany: jest.fn().mockResolvedValue([]) }, dailyAttendance: { findMany: jest.fn().mockResolvedValue([]) } };
    const evaluator: any = { evaluate: jest.fn().mockResolvedValue(unofficial()) };
    const svc = new MyAttendanceV2Service(prisma, tva(), evaluator);
    const feb = await svc.overview('u1', '2027-02');
    expect(feb.financialYear.label).toBe('2026-2027');
    expect(feb.financialYear.months[0]).toBe('2026-04');
    expect(feb.financialYear.months[11]).toBe('2027-03');
    const prev = await svc.overview('u1', '2026-02');
    expect(prev.financialYear.label).toBe('2025-2026');
  });
});

// ── R: recovered history ─────────────────────────────────────────────────────────────────────────────────────

const unofficial = () => ({
  employeeId: 'u1', businessDate: '2026-04-01', official: false, status: null, evaluationState: 'CALCULATED',
  calculationReason: 'NOT_APPLICABLE_NOT_EMPLOYED', exceptionFlags: [], punchInAt: null, punchOutAt: null,
  workedMinutes: 0, breakMinutes: 0, lateMinutes: 0, presenceMinutes: null, requiredMinutes: null, leaveDeducted: 0, lwpDeducted: 0,
  requiresReview: false, blockingReasons: [],
});
const recovered = (date: string, over: Partial<StoredRecoveredDay> = {}): StoredRecoveredDay => ({
  date, status: 'PRESENT', evaluationState: 'FINALIZED', exceptionFlags: [], workedMinutes: 535,
  punchInAt: new Date(`${date}T04:43:00.000Z`), punchOutAt: new Date(`${date}T13:37:00.000Z`), ...over,
});

describe('R recovered historical days in My Attendance', () => {
  it('R1. a two-punch day shows Present with its real punches and a measured span', () => {
    const d = mapRecoveredDay(recovered('2026-04-03'), '2026-10-12');
    expect(d).toMatchObject({ outcome: 'PRESENT', isApplicable: true, evaluationState: 'FINALIZED', presenceMinutes: 534, workedMinutes: 535, reason: 'HISTORICAL_RECOVERY_IMPORT' });
    expect(d.punchInAt).toBe('2026-04-03T04:43:00.000Z');
    expect(d.punchOutAt).toBe('2026-04-03T13:37:00.000Z');
  });

  it('R1b. backend summaries count stored facts and keep review rows visible', () => {
    const present = mapRecoveredDay(recovered('2026-04-03'), '2026-10-12');
    const review = mapRecoveredDay(recovered('2026-04-04', {
      punchOutAt: null,
      evaluationState: 'NEEDS_REVIEW',
      exceptionFlags: ['MISSING_PUNCH'],
      workedMinutes: 0,
    }), '2026-10-12');
    expect(summarizeAttendanceDays([present, review])).toMatchObject({
      recordedDays: 2,
      finalizedDays: 1,
      present: 1,
      needsReview: 1,
    });
  });

  it('R2. break and lateness are unavailable, never 0:00 or "on time"; no requirement is invented', () => {
    const d = mapRecoveredDay(recovered('2026-04-03'), '2026-10-12');
    expect(d.breakMinutes).toBeNull();
    expect(d.lateMinutes).toBeNull();
    expect(d.requiredMinutes).toBeNull();
    expect(d.modifiers).toEqual([]);
    const gaps = Object.fromEntries(d.unavailable.map((u) => [u.field, u.reason]));
    expect(gaps.breakMinutes).toBe('NOT_RECORDED_HISTORICAL');
    expect(gaps.lateMinutes).toBe('NOT_ASSESSED_HISTORICAL');
    expect(d.explanation).toMatch(/not recorded/i);
  });

  it('R3. a one-punch day is unresolved, names the punch that is missing, and has no span or worked time', () => {
    const noOut = mapRecoveredDay(recovered('2026-04-03', { punchOutAt: null, evaluationState: 'NEEDS_REVIEW', exceptionFlags: ['MISSING_PUNCH'], workedMinutes: 0 }), '2026-10-12');
    expect(noOut).toMatchObject({ outcome: 'UNRESOLVED', presenceMinutes: null, workedMinutes: null, evaluationState: 'NEEDS_REVIEW' });
    expect(noOut.exceptions).toEqual(['MISSING_OUT']);
    const noIn = mapRecoveredDay(recovered('2026-04-03', { punchInAt: null, evaluationState: 'NEEDS_REVIEW', exceptionFlags: ['MISSING_PUNCH'], workedMinutes: 0 }), '2026-10-12');
    expect(noIn.exceptions).toEqual(['MISSING_IN']);
  });

  it.each([['HOLIDAY'], ['WEEKLY_OFF']])('R4. a recovered %s is that outcome with no worked, break or late figures', (status) => {
    const d = mapRecoveredDay(recovered('2026-05-01', { status, punchInAt: null, punchOutAt: null, workedMinutes: 0 }), '2026-10-12');
    expect(d.outcome).toBe(status);
    expect([d.workedMinutes, d.breakMinutes, d.lateMinutes, d.presenceMinutes]).toEqual([null, null, null, null]);
  });

  it('R5. the month shows recovered days as stored, still asks the evaluator for every other day, and replaces no native day', async () => {
    const prisma: any = {
      workSession: { findMany: jest.fn().mockResolvedValue([]) },
      dailyAttendance: { findMany: jest.fn().mockResolvedValue([{ ...recovered('2026-04-02'), date: new Date('2026-04-02T00:00:00.000Z') }, { ...recovered('2026-04-03'), date: new Date('2026-04-03T00:00:00.000Z') }]) },
    };
    const evaluator: any = { evaluate: jest.fn().mockResolvedValue(unofficial()) };
    const svc = new MyAttendanceV2Service(prisma, tva(), evaluator);
    const out = await svc.overview('u1', '2026-04');

    expect(out.month.days).toHaveLength(30);
    expect(out.month.days.find((d) => d.date === '2026-04-02')!.outcome).toBe('PRESENT');
    expect(out.month.days.find((d) => d.date === '2026-04-03')!.outcome).toBe('PRESENT');
    expect(out.month.days.find((d) => d.date === '2026-04-06')!.outcome).toBeNull(); // nothing recovered: the evaluator's answer stands
    const asked = evaluator.evaluate.mock.calls.map((c: any[]) => c[1]);
    expect(asked).not.toContain('2026-04-02');
    expect(asked).not.toContain('2026-04-03');
    expect(asked).toContain('2026-04-06');
    // only recovered rows are ever read from DailyAttendance here
    expect(prisma.dailyAttendance.findMany.mock.calls[0][0].where.calculationReason).toBe('HISTORICAL_RECOVERY_IMPORT');
  });

  it('R6. a single recovered day answers from the stored row without calling the evaluator', async () => {
    const prisma: any = {
      workSession: { findMany: jest.fn().mockResolvedValue([]) },
      dailyAttendance: { findMany: jest.fn().mockResolvedValue([{ ...recovered('2026-05-04'), date: new Date('2026-05-04T00:00:00.000Z') }]) },
    };
    const evaluator: any = { evaluate: jest.fn() };
    const day = await new MyAttendanceV2Service(prisma, tva(), evaluator).day('u1', '2026-05-04');
    expect(day.outcome).toBe('PRESENT');
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it('R7. day detail returns stored session ranges, work context and breaks without reconstructing missing values', async () => {
    const workSession = {
      id: 'session-1', loginAt: new Date('2026-05-04T04:25:00.000Z'), startWorkAt: new Date('2026-05-04T04:30:00.000Z'),
      logoutAt: null, status: 'WORKING', totalWorkMinutes: 175, autoClosed: false, autoClosedAt: null, closureReason: null,
      breakLogs: [{
        id: 'break-1', breakType: 'MEETING', startAt: new Date('2026-05-04T06:00:00.000Z'), endAt: null,
        durationMinutes: null, note: null, reason: null, meeting: { topic: 'Client review', purpose: 'DELIVERY', clientName: 'Acme' },
      }],
      ticketTimeLogs: [{
        id: 'log-1', startedAt: new Date('2026-05-04T04:30:00.000Z'), endedAt: null, durationSeconds: null,
        ticket: { ticketId: 'APX-42', title: 'Attendance drawer' },
      }],
      workdayNotes: [{ id: 'note-1', content: 'Validated the day detail flow', createdAt: new Date('2026-05-04T05:00:00.000Z') }],
    };
    const findMany = jest.fn().mockResolvedValueOnce([workSession]).mockResolvedValueOnce([]);
    const prisma: any = {
      workSession: { findMany },
      dailyAttendance: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const evaluator: any = { evaluate: jest.fn().mockResolvedValue(unofficial()) };

    const day = await new MyAttendanceV2Service(prisma, tva(), evaluator).day('u1', '2026-05-04');

    expect(findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', date: new Date('2026-05-04T00:00:00.000Z') });
    expect(day.workSessions[0]).toMatchObject({
      id: 'session-1', startedAt: '2026-05-04T04:30:00.000Z', endedAt: null, workedMinutes: 175,
      workItems: [{ ticketId: 'APX-42', title: 'Attendance drawer', endedAt: null, durationSeconds: null }],
      notes: [{ content: 'Validated the day detail flow' }],
      breaks: [{ type: 'MEETING', endedAt: null, durationMinutes: null, purpose: 'Client review · DELIVERY · Acme' }],
    });
  });
});

// ── C: correction requests ────────────────────────────────────────────────────────────────────────────────────

const DATE = '2026-08-20';
const DATE_ONLY = new Date(`${DATE}T00:00:00.000Z`);

function correctionRig(f: { open?: any; official?: any; request?: any; isHR?: boolean; chain?: any[] } = {}) {
  const created: any[] = []; const audit: any[] = []; const updates: any[] = [];
  const request = f.request ?? { id: 'reg-1', userId: 'emp-1', date: DATE_ONLY, status: 'MANAGER_APPROVED', requestType: 'OTHER', policyCorrectionType: 'INCORRECT_ATTENDANCE_STATUS', reason: '[Status] shows absent', basedOnFingerprint: 'fp-1' };
  const tx: any = {
    ...makeRawSqlDouble(() => [{ id: 'x' }]),
    attendanceRegularization: { findUnique: jest.fn().mockResolvedValue(request), update: jest.fn(({ data }: any) => { updates.push(data); return Promise.resolve({ ...request, ...data }); }) },
    dailyAttendance: { findUnique: jest.fn().mockResolvedValue({ id: 'da-1', sourceFingerprint: 'fp-DIFFERENT', status: 'PRESENT' }) },
  };
  const prisma: any = {
    // create() passes transaction options and gets the submission view of the
    // database; the approval path passes none and gets the approval tx.
    $transaction: jest.fn((fn: any, options?: any) => fn(options ? { ...prisma, ...makeRawSqlDouble() } : tx)),
    attendanceRegularization: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(f.open ?? null), findUnique: tx.attendanceRegularization.findUnique, create: jest.fn(({ data }: any) => { created.push(data); return Promise.resolve({ id: 'reg-new', ...data }); }), update: tx.attendanceRegularization.update },
    dailyAttendance: { findUnique: jest.fn().mockResolvedValue('official' in f ? f.official : { sourceFingerprint: 'fp-1', punchInAt: new Date('2026-08-20T04:30:00.000Z'), punchOutAt: new Date('2026-08-20T13:00:00.000Z') }) },
  };
  const evaluator: any = { reviseForApprovedCorrection: jest.fn().mockResolvedValue({ before: { id: 'da-1', status: 'PRESENT' }, after: { id: 'da-1', status: 'PRESENT', revision: 1 }, result: {} }) };
  const chain = f.chain ?? [{ id: 'mgr-1', tier: 'MANAGER' }];
  const service = new RegularizationService(
    prisma, tva(), { log: jest.fn((e: any) => { audit.push(e); return Promise.resolve(undefined); }) } as any,
    { resolveApproverChainFor: jest.fn().mockResolvedValue(chain), isApproverFor: jest.fn(async (id: string) => chain.some((c: any) => c.id === id)) } as any,
    { isHrOrAdmin: () => f.isHR === true } as any, { get: jest.fn().mockResolvedValue({ regularizationEnabled: true }) } as any, evaluator,
  );
  return { service, created, audit, updates, evaluator };
}

describe('C correction requests', () => {
  it('C1. a future date cannot be corrected', async () => {
    const { service, created } = correctionRig();
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await expect(service.create('emp-1', { businessDate: future, requestType: 'INCORRECT_ATTENDANCE_STATUS', reason: 'status is wrong' })).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toEqual([]);
  });

  it('C2. the stored punches the employee is arguing against are kept on the request', async () => {
    const { service, created } = correctionRig();
    await service.create('emp-1', { businessDate: DATE, requestType: 'INCORRECT_PUNCH_OUT', reason: 'punch out was wrong', requestedPunchOut: '2026-08-20T13:40:00.000Z' });
    expect(created[0].originalPunchIn).toEqual(new Date('2026-08-20T04:30:00.000Z'));
    expect(created[0].originalPunchOut).toEqual(new Date('2026-08-20T13:00:00.000Z'));
    expect(created[0].status).toBe('PENDING');
  });

  it('C3. a day with no stored record is still correctable and stores no originals', async () => {
    const { service, created } = correctionRig({ official: null });
    await service.create('emp-1', { businessDate: DATE, requestType: 'MISSING_PUNCH_IN', reason: 'never recorded', requestedPunchIn: '2026-08-20T04:00:00.000Z' });
    expect([created[0].originalPunchIn, created[0].originalPunchOut]).toEqual([null, null]);
  });

  it.each(['INCORRECT_ATTENDANCE_STATUS', 'MISSING_PUNCH_IN', 'INCORRECT_PUNCH_IN'])('C4. %s needs a reason', async (requestType) => {
    const { service } = correctionRig();
    await expect(service.create('emp-1', { businessDate: DATE, requestType: requestType as any, reason: '  ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('C5. a second open request for the same day is refused', async () => {
    const { service } = correctionRig({ open: { id: 'reg-open', status: 'PENDING' } });
    await expect(service.create('emp-1', { businessDate: DATE, requestType: 'INCORRECT_ATTENDANCE_STATUS', reason: 'again please' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('C6. submitting a status correction changes no attendance before approval', async () => {
    const { service, created, evaluator } = correctionRig();
    await service.create('emp-1', { businessDate: DATE, requestType: 'INCORRECT_ATTENDANCE_STATUS', reason: '[Worked hours] hours look short' });
    expect(created).toHaveLength(1);
    expect(created[0].requestType).toBe('OTHER');
    expect(created[0].policyCorrectionType).toBe('INCORRECT_ATTENDANCE_STATUS');
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('C7. HR approving an OTHER request records the decision and never rewrites the official day', async () => {
    const { service, evaluator, audit, updates } = correctionRig({ isHR: true });
    // the day moved on since the request (different fingerprint): a punch correction would be refused, a review-only one is not
    const approved = await service.approveAsHr({ id: 'hr-1' }, 'reg-1');
    expect(approved.status).toBe('HR_APPROVED');
    expect(updates[0]).toMatchObject({ status: 'HR_APPROVED', hrApproverId: 'hr-1' });
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
    expect(audit.some((e) => e.action === 'ATTENDANCE_OFFICIAL_REVISED')).toBe(false);
    expect(audit.some((e) => e.toState === 'HR_APPROVED')).toBe(true);
  });

  it('C8. a punch correction is still applied by HR, and only HR may give final approval', async () => {
    const punch = { id: 'reg-2', userId: 'emp-1', date: DATE_ONLY, status: 'MANAGER_APPROVED', requestType: 'MISSING_PUNCH', policyCorrectionType: 'MISSING_PUNCH_OUT', reason: 'crashed', basedOnFingerprint: 'fp-1' };
    const hr = correctionRig({ isHR: true, request: punch });
    // fingerprint on the day equals the request's, so the staleness guard passes
    (hr.service as any).prisma.$transaction = jest.fn((fn: any) => fn({ ...makeRawSqlDouble(() => [{ id: 'x' }]), attendanceRegularization: { findUnique: jest.fn().mockResolvedValue(punch), update: jest.fn(({ data }: any) => Promise.resolve({ ...punch, ...data })) }, dailyAttendance: { findUnique: jest.fn().mockResolvedValue({ id: 'da-1', sourceFingerprint: 'fp-1' }) } }));
    await hr.service.approveAsHr({ id: 'hr-1' }, 'reg-2');
    expect(hr.evaluator.reviseForApprovedCorrection).toHaveBeenCalledTimes(1);

    const notHr = correctionRig({ isHR: false });
    await expect(notHr.service.approveAsHr({ id: 'mgr-1' }, 'reg-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('C9 recovered historical days are protected from punch corrections', () => {
  const recoveredDay = { sourceFingerprint: 'fp-1', calculationReason: 'HISTORICAL_RECOVERY_IMPORT', punchInAt: new Date('2026-08-20T04:30:00.000Z'), punchOutAt: null };

  it('C9a. a punch correction cannot be raised against a recovered day, and the message says what to do', async () => {
    const { service, created } = correctionRig({ official: recoveredDay });
    await expect(service.create('emp-1', { businessDate: DATE, requestType: 'MISSING_PUNCH_OUT', reason: 'punch out is missing', requestedPunchOut: '2026-08-20T13:00:00.000Z' })).rejects.toThrow(/Incorrect Attendance Status/i);
    expect(created).toEqual([]);
  });

  it('C9b. the same day can still be raised for a status correction', async () => {
    const { service, created } = correctionRig({ official: recoveredDay });
    await service.create('emp-1', { businessDate: DATE, requestType: 'INCORRECT_ATTENDANCE_STATUS', reason: '[Other] one punch is missing' });
    expect(created).toHaveLength(1);
  });

  it('C9c. even an older punch request cannot be approved over a recovered day: the evaluator is never asked to rewrite it', async () => {
    const punch = { id: 'reg-3', userId: 'emp-1', date: DATE_ONLY, status: 'MANAGER_APPROVED', requestType: 'MISSING_PUNCH', policyCorrectionType: 'MISSING_PUNCH_OUT', reason: 'old request', basedOnFingerprint: 'fp-1' };
    const rig = correctionRig({ isHR: true, request: punch });
    (rig.service as any).prisma.$transaction = jest.fn((fn: any) => fn({ ...makeRawSqlDouble(() => [{ id: 'x' }]), attendanceRegularization: { findUnique: jest.fn().mockResolvedValue(punch), update: jest.fn() }, dailyAttendance: { findUnique: jest.fn().mockResolvedValue({ id: 'da-1', ...recoveredDay }) } }));
    await expect(rig.service.approveAsHr({ id: 'hr-1' }, 'reg-3')).rejects.toBeInstanceOf(ForbiddenException);
    expect(rig.evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });
});

// ── L: monthly correction limits ─────────────────────────────────────────────────────────────────────────────

// An in-memory regularization table. count() evaluates the service's own where
// clause, so these tests also pin the employee, month, bucket and legacy filters.
const PUNCH_MSG = 'The monthly limit of ten missing/incorrect punch correction requests has been reached.';
const STATUS_MSG = 'The monthly limit of four attendance-status correction requests has been reached.';
const PUNCH_TYPES = ['MISSING_PUNCH_IN', 'MISSING_PUNCH_OUT', 'INCORRECT_PUNCH_IN', 'INCORRECT_PUNCH_OUT'] as const;

const matchesValue = (value: any, cond: any): boolean => {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond === 'object') {
    if ('in' in cond) return cond.in.includes(value);
    if ('gte' in cond || 'lt' in cond) return (!cond.gte || value >= cond.gte) && (!cond.lt || value < cond.lt);
  }
  return value === cond;
};
const matchesWhere = (row: any, where: any): boolean => Object.entries(where).every(([key, cond]: [string, any]) =>
  key === 'OR' ? cond.some((alt: any) => matchesWhere(row, alt)) : matchesValue(row[key], cond));

function limitRig(rows: any[] = []) {
  const table = rows.map((r) => ({ status: 'PENDING', policyCorrectionType: null, ...r, date: new Date(`${r.date}T00:00:00.000Z`) }));
  const raw = makeRawSqlDouble();
  const prisma: any = {
    $transaction: jest.fn((fn: any) => fn({ ...prisma, ...raw })),
    attendanceRegularization: {
      count: jest.fn(({ where }: any) => Promise.resolve(table.filter((r) => matchesWhere(r, where)).length)),
      findFirst: jest.fn(({ where }: any) => Promise.resolve(table.find((r) => matchesWhere(r, where)) ?? null)),
      create: jest.fn(({ data }: any) => { const row = { id: `reg-${table.length + 1}`, ...data }; table.push(row); return Promise.resolve(row); }),
    },
    dailyAttendance: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn(), upsert: jest.fn(), create: jest.fn() },
  };
  const evaluator: any = { reviseForApprovedCorrection: jest.fn() };
  const service = new RegularizationService(
    prisma, tva(), { log: jest.fn().mockResolvedValue(undefined) } as any,
    { resolveApproverChainFor: jest.fn().mockResolvedValue([{ id: 'mgr-1', tier: 'MANAGER' }]), isApproverFor: jest.fn() } as any,
    { isHrOrAdmin: () => false } as any, { get: jest.fn().mockResolvedValue({ regularizationEnabled: true }) } as any, evaluator,
  );
  const submit = (requestType: string, date: string, userId = 'emp-1') =>
    service.create(userId, { businessDate: date, requestType: requestType as any, reason: 'please correct this day' });
  return { service, prisma, evaluator, table, submit, raw };
}
// Distinct past days in August 2026, so the one-open-request-per-day rule never interferes.
const aug = (day: number) => `2026-08-${String(day).padStart(2, '0')}`;
const punchRows = (n: number, over: any = {}) => Array.from({ length: n }, (_, i) => ({ userId: 'emp-1', date: aug(i + 1), requestType: 'MISSING_PUNCH', policyCorrectionType: PUNCH_TYPES[i % 4], ...over }));
const statusRows = (n: number, over: any = {}) => Array.from({ length: n }, (_, i) => ({ userId: 'emp-1', date: aug(i + 11), requestType: 'OTHER', policyCorrectionType: 'INCORRECT_ATTENDANCE_STATUS', ...over }));

describe('L monthly correction limits', () => {
  it('L0. the named limits are ten punch and four status corrections', () => {
    expect(PUNCH_CORRECTION_MONTHLY_LIMIT).toBe(10);
    expect(STATUS_CORRECTION_MONTHLY_LIMIT).toBe(4);
  });

  it.each(Array.from({ length: 10 }, (_, used) => [used]))('L1. with %i punch corrections used, the next one is accepted', async (used) => {
    const { submit, table } = limitRig(punchRows(used));
    await expect(submit('MISSING_PUNCH_IN', aug(25))).resolves.toBeDefined();
    expect(table).toHaveLength(used + 1);
    expect(table.at(-1)).toMatchObject({ requestType: 'MISSING_PUNCH', policyCorrectionType: 'MISSING_PUNCH_IN', status: 'PENDING' });
  });

  it.each(PUNCH_TYPES.map((t) => [t]))('L2. with 10 punch corrections used, an 11th %s is refused with the ten-request message', async (type) => {
    const { submit, prisma } = limitRig(punchRows(10));
    await expect(submit(type, aug(25))).rejects.toThrow(new BadRequestException(PUNCH_MSG));
    expect(prisma.attendanceRegularization.create).not.toHaveBeenCalled();
  });

  it('L3. the four punch types share ONE combined bucket of ten, not ten each', async () => {
    const { submit, table } = limitRig();
    for (let i = 0; i < 10; i++) await submit(PUNCH_TYPES[i % 4], aug(i + 1));
    expect(new Set(table.map((r) => r.policyCorrectionType))).toEqual(new Set(PUNCH_TYPES));
    for (const type of PUNCH_TYPES) await expect(submit(type, aug(25))).rejects.toThrow(PUNCH_MSG);
    expect(table).toHaveLength(10);
  });

  it.each([[0], [1], [2], [3]])('L4. with %i status corrections used, the next one is accepted', async (used) => {
    const { submit, table } = limitRig(statusRows(used));
    await expect(submit('INCORRECT_ATTENDANCE_STATUS', aug(25))).resolves.toBeDefined();
    expect(table).toHaveLength(used + 1);
    expect(table.at(-1)).toMatchObject({ requestType: 'OTHER', policyCorrectionType: 'INCORRECT_ATTENDANCE_STATUS', status: 'PENDING' });
  });

  it('L5. with 4 status corrections used, a 5th is refused with the four-request message', async () => {
    const { submit, prisma } = limitRig(statusRows(4));
    await expect(submit('INCORRECT_ATTENDANCE_STATUS', aug(25))).rejects.toThrow(new BadRequestException(STATUS_MSG));
    expect(prisma.attendanceRegularization.create).not.toHaveBeenCalled();
  });

  it('L6. ten punch corrections do not consume the status bucket', async () => {
    const { submit } = limitRig(punchRows(10));
    for (let i = 0; i < 4; i++) await submit('INCORRECT_ATTENDANCE_STATUS', aug(i + 11));
    await expect(submit('INCORRECT_ATTENDANCE_STATUS', aug(25))).rejects.toThrow(STATUS_MSG);
  });

  it('L7. four status corrections do not consume the punch bucket', async () => {
    const { submit } = limitRig(statusRows(4));
    for (let i = 0; i < 10; i++) await submit(PUNCH_TYPES[i % 4], aug(i + 1));
    await expect(submit('MISSING_PUNCH_OUT', aug(25))).rejects.toThrow(PUNCH_MSG);
  });

  it('L8. the limit is per employee: another employee\'s full buckets do not count', async () => {
    const { submit, prisma } = limitRig([...punchRows(10, { userId: 'emp-2' }), ...statusRows(4, { userId: 'emp-2' })]);
    await expect(submit('MISSING_PUNCH_IN', aug(25))).resolves.toBeDefined();
    await expect(submit('INCORRECT_ATTENDANCE_STATUS', aug(26))).resolves.toBeDefined();
    expect(prisma.attendanceRegularization.count.mock.calls.every(([{ where }]: any) => where.userId === 'emp-1')).toBe(true);
    await expect(submit('MISSING_PUNCH_IN', aug(27), 'emp-2')).rejects.toThrow(PUNCH_MSG);
  });

  it('L9. the limit resets at the next calendar month, bounded by company dates', async () => {
    const { submit, prisma } = limitRig([...punchRows(10), ...statusRows(4)]);
    await expect(submit('MISSING_PUNCH_IN', '2026-08-31')).rejects.toThrow(PUNCH_MSG);
    await expect(submit('MISSING_PUNCH_IN', '2026-09-01')).resolves.toBeDefined();
    await expect(submit('INCORRECT_ATTENDANCE_STATUS', '2026-09-02')).resolves.toBeDefined();
    const where = prisma.attendanceRegularization.count.mock.calls.at(-1)[0].where;
    expect(where.date).toEqual({ gte: tva().companyDateOnly(new Date(Date.UTC(2026, 8, 1))), lt: tva().companyDateOnly(new Date(Date.UTC(2026, 9, 1))) });
  });

  it('L10. rejected requests still count as submissions in both buckets', async () => {
    const { submit } = limitRig([...punchRows(10, { status: 'REJECTED' }), ...statusRows(4, { status: 'REJECTED' })]);
    await expect(submit('MISSING_PUNCH_IN', aug(25))).rejects.toThrow(PUNCH_MSG);
    await expect(submit('INCORRECT_ATTENDANCE_STATUS', aug(25))).rejects.toThrow(STATUS_MSG);
  });

  it('L11. legacy rows without a policy type are counted in their own bucket only', async () => {
    const legacyPunch = ['MISSING_PUNCH', 'LATE_CORRECTION', 'HALF_DAY_CORRECTION'];
    const punch = limitRig(Array.from({ length: 10 }, (_, i) => ({ userId: 'emp-1', date: aug(i + 1), requestType: legacyPunch[i % 3], policyCorrectionType: null })));
    await expect(punch.submit('INCORRECT_PUNCH_IN', aug(25))).rejects.toThrow(PUNCH_MSG);
    await expect(punch.submit('INCORRECT_ATTENDANCE_STATUS', aug(25))).resolves.toBeDefined();

    const status = limitRig(statusRows(4, { policyCorrectionType: null }));
    await expect(status.submit('INCORRECT_ATTENDANCE_STATUS', aug(25))).rejects.toThrow(STATUS_MSG);
    await expect(status.submit('MISSING_PUNCH_OUT', aug(25))).resolves.toBeDefined();
  });

  it('L12. one open request per day still applies below the monthly limits', async () => {
    const { submit, prisma } = limitRig([{ userId: 'emp-1', date: aug(25), requestType: 'MISSING_PUNCH', policyCorrectionType: 'MISSING_PUNCH_IN', status: 'PENDING' }]);
    await expect(submit('INCORRECT_ATTENDANCE_STATUS', aug(25))).rejects.toThrow(new ForbiddenException('A correction for this date is already under review'));
    expect(prisma.attendanceRegularization.create).not.toHaveBeenCalled();
  });

  it('L13. submitting up to the limits writes correction requests only, never attendance', async () => {
    const { submit, prisma, evaluator } = limitRig();
    for (let i = 0; i < 10; i++) await submit(PUNCH_TYPES[i % 4], aug(i + 1));
    for (let i = 0; i < 4; i++) await submit('INCORRECT_ATTENDANCE_STATUS', aug(i + 11));
    expect(prisma.attendanceRegularization.create).toHaveBeenCalledTimes(14);
    expect(prisma.dailyAttendance.update).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.create).not.toHaveBeenCalled();
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('L14. count and create run in one transaction after a per-employee, per-month advisory lock', async () => {
    const { submit, prisma, raw } = limitRig();
    await submit('MISSING_PUNCH_IN', aug(25));
    await submit('INCORRECT_ATTENDANCE_STATUS', aug(26));
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(raw.$queryRaw).not.toHaveBeenCalled();
    expect(raw.executed).toHaveLength(2);
    for (const [sql, key] of raw.executed) {
      expect(sql.join('?')).toContain('pg_advisory_xact_lock(hashtext(');
      // Parameterized: the key is a bound value, never part of the SQL text.
      expect(key).toBe('attendance-correction-limit:emp-1:2026-08');
    }
    const lockOrder = raw.$executeRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(prisma.attendanceRegularization.count.mock.invocationCallOrder[0]);
    expect(prisma.attendanceRegularization.count.mock.invocationCallOrder[0]).toBeLessThan(prisma.attendanceRegularization.create.mock.invocationCallOrder[0]);
  });
});

// ── H: who a history report includes ─────────────────────────────────────────────────────────────────────────

function consoleRig(users: any[], stored: any[] = []) {
  const userFinds: any[] = [];
  const prisma: any = {
    user: { findUnique: jest.fn(), findMany: jest.fn((args: any) => { userFinds.push(args); return Promise.resolve(users); }), count: jest.fn().mockResolvedValue(users.length) },
    dailyAttendance: { findMany: jest.fn().mockResolvedValue(stored) },
    attendanceRegularization: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    // Phase 3: the HR register also lists punch devices.
    attendancePunchEvidence: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const calendar: any = { classifyMonth: jest.fn().mockResolvedValue({ days: [{ businessDate: '2026-08-03', isWorkingDay: true }, { businessDate: '2026-08-04', isWorkingDay: true }], workingDays: 2, sources: { weeklyOffPolicy: 'ASSIGNED' } }) };
  const service = new AttendanceConsoleService(
    prisma, tva(), { isHrOrAdmin: () => true } as any, null as any, null as any, null as any,
    { blockedFromLastRun: jest.fn().mockResolvedValue(null) } as any, calendar, { getLeaveBalance: jest.fn().mockResolvedValue({ balance: 5 }) } as any,
  );
  return { service, userFinds };
}
const HR = { id: 'hr-1', isHR: true, role: { name: 'ADMIN' } };
const former = { id: 'u-old', name: 'Gunjan Ranglani', employeeId: 'OWN0048', isActive: false, department: null };
const storedRow = (userId: string, date: string) => ({ userId, date: new Date(`${date}T00:00:00.000Z`), status: 'PRESENT', evaluationState: 'FINALIZED', punchInAt: new Date(`${date}T04:30:00.000Z`), punchOutAt: new Date(`${date}T13:30:00.000Z`) });

describe('H history includes former employees who have records', () => {
  it('H1. a past month asks for active people OR anyone with a stored row in that month', async () => {
    const { service, userFinds } = consoleRig([former], [storedRow('u-old', '2026-08-03')]);
    await service.monthlyRegister(HR, { from: '2026-08-01', to: '2026-08-31' });
    const where = userFinds[0].where;
    expect(where.isActive).toBeUndefined();
    const or = where.AND[0].OR;
    expect(or[0]).toEqual({ isActive: true });
    expect(or[1].dailyAttendanceRecords.some.date.gte).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    expect(or[1].dailyAttendanceRecords.some.date.lte).toEqual(new Date('2026-08-31T00:00:00.000Z'));
  });

  it('H2. a former employee appears with their recorded days, marked inactive', async () => {
    const { service } = consoleRig([former], [storedRow('u-old', '2026-08-03'), storedRow('u-old', '2026-08-04')]);
    const out = await service.monthlyRegister(HR, { from: '2026-08-01', to: '2026-08-31' });
    expect(out.employees).toHaveLength(1);
    expect(out.employees[0]).toMatchObject({ name: 'Gunjan Ranglani', isActive: false, daysPresent: 2 });
  });

  it('H3. today is operational: only active people', async () => {
    const t = tva().companyToday();
    const { service, userFinds } = consoleRig([]);
    await service.roster(HR, { businessDate: t });
    expect(userFinds[0].where).toEqual({ isActive: true });
    await service.todaySummary(HR, t);
    expect(userFinds[1].where).toEqual({ isActive: true });
  });

  it('H4. a past day in the roster also includes former employees who worked it', async () => {
    const { service, userFinds } = consoleRig([former], [storedRow('u-old', '2026-08-03')]);
    await service.roster(HR, { businessDate: '2026-08-03' });
    expect(userFinds[0].where.AND[0].OR[0]).toEqual({ isActive: true });
    expect(userFinds[0].where.AND[0].OR[1].dailyAttendanceRecords).toBeDefined();
  });
});

// ── M: backward compatibility with a backend that predates the financial year ──────────────────────────────────

describe('M missing financialYear from an older backend', () => {
  const real = financialYearV2(2026, 4);

  it('M1. a missing, null or non-object value means no yearly view (nothing is invented)', () => {
    for (const value of [undefined, null, 'FY 2026-27', 7, []]) expect(usableFinancialYear(value)).toBeNull();
  });

  it('M2. an incomplete or malformed year is refused rather than repaired', () => {
    const { months, ...noMonths } = real;
    for (const bad of [{}, noMonths, { ...real, months: [] }, { ...real, months: ['2026-4'] }, { ...real, months: ['2026-13'] }, { ...real, startMonth: 13 }, { ...real, startYear: '2026' }, { ...real, label: '' }]) {
      expect(usableFinancialYear(bad)).toBeNull();
    }
  });

  it('M3. the real backend year is returned unchanged, so the backend stays the source of truth', () => {
    expect(usableFinancialYear(real)).toBe(real);
    expect(usableFinancialYear(real)?.months[0]).toBe('2026-04');
  });

  it('M4. the page reads the year only through the guard, never straight off the response', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../frontend/components/attendance-v2/MyAttendanceInsights.tsx'), 'utf8');
    expect(src).toContain('usableFinancialYear(overview.financialYear)');
    expect(src.match(/overview\.financialYear\./)).toBeNull();
    expect(fs.readFileSync(path.join(__dirname, '../../../frontend/components/attendance-v2/my-attendance-v2-api.ts'), 'utf8')).toMatch(/financialYear\?: FinancialYearV2/);
  });
});

// ── S: the read surfaces write nothing ───────────────────────────────────────────────────────────────────────

describe('S no write paths', () => {
  it('S1. the My Attendance read service has no create / update / delete / upsert / raw SQL', () => {
    const code = fs.readFileSync(path.join(__dirname, '../../src/modules/platform/attendance/v2/my-attendance-v2.service.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code.match(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|\$queryRaw|\$transaction/)).toBeNull();
  });
});
