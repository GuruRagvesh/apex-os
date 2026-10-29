import { BadRequestException } from '@nestjs/common';
import { CorrectionDecisionService } from '../../src/modules/platform/attendance/regularization/correction-decision.service';

/**
 * Approving an "incorrect attendance status" correction.
 *
 * It used to be review-only. It is now applied, but only through the same
 * gates as a punch correction (stale check, month and day locks) plus its own:
 * the reviewer states the status granted, the day must be one a status
 * correction may change, and the evaluator must actually settle the day at
 * that status. Anything else is held at REVIEW_REQUIRED, never half-applied.
 */

const DATE = new Date('2026-09-09T00:00:00.000Z');
const NOW = new Date('2026-09-10T09:00:00.000Z');

function rig(opts: { official?: any; revisedTo?: any; monthClose?: any; row?: any } = {}) {
  const row = {
    id: 'reg-1',
    userId: 'emp-1',
    date: DATE,
    status: 'PENDING',
    requestType: 'OTHER',
    policyCorrectionType: 'INCORRECT_ATTENDANCE_STATUS',
    requestedPunchIn: null,
    requestedPunchOut: null,
    proposedStatus: null,
    basedOnFingerprint: 'fp-1',
    createdById: 'emp-1',
    ...opts.row,
  };
  const official =
    opts.official === undefined
      ? {
          id: 'day-1',
          userId: 'emp-1',
          status: 'ABSENT',
          evaluationState: 'CALCULATED',
          calculationReason: 'NO_PUNCH',
          punchInAt: new Date('2026-09-09T04:00:00.000Z'),
          punchOutAt: new Date('2026-09-09T13:30:00.000Z'),
          revision: 0,
          lastRegularizationId: null,
          leaveRequestId: null,
          locked: false,
          sourceFingerprint: 'fp-1',
        }
      : opts.official;

  // Every write in every attempt, in order, so a test can see what each
  // transaction did -- and that a rolled-back attempt was retried as a hold.
  const attempts: Array<{ updates: any[]; audits: any[] }> = [];
  const evaluator: any = {
    reviseForApprovedCorrection: jest.fn(async () => ({
      before: official,
      after: { ...official, ...(opts.revisedTo ?? { status: 'PRESENT', evaluationState: 'CALCULATED' }), revision: (official?.revision ?? 0) + 1, lastRegularizationId: row.id },
    })),
  };
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => {
      const attempt = { updates: [] as any[], audits: [] as any[] };
      attempts.push(attempt);
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        $executeRaw: jest.fn().mockResolvedValue(1),
        attendanceRegularization: {
          findUnique: jest.fn().mockResolvedValue(row),
          update: jest.fn(async (args: any) => {
            attempt.updates.push(args.data);
            return { ...row, ...args.data };
          }),
        },
        dailyAttendance: { findUnique: jest.fn().mockResolvedValue(official) },
        attendanceMonthClose: { findUnique: jest.fn().mockResolvedValue(opts.monthClose ?? null) },
        operationalEvent: { create: jest.fn(async (args: any) => attempt.audits.push(args.data)) },
        user: { findUnique: jest.fn().mockResolvedValue({ name: 'HR' }) },
      };
      return fn(tx);
    }),
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Someone' }) },
  };
  const logged: any[] = [];
  const service = new CorrectionDecisionService(
    prisma,
    { companyBusinessDate: () => '2026-09-09', now: () => NOW } as any,
    { log: jest.fn(async (e: any) => logged.push(e)) } as any,
    { get: jest.fn().mockResolvedValue({ correctionDecisionEnabled: true }) } as any,
    evaluator,
    {
      loadActor: jest.fn().mockResolvedValue({ id: 'hr-1', isActive: true, isHR: true }),
      eligibility: jest.fn().mockResolvedValue({ scope: 'company', role: 'HR', via: 'HR' }),
      canViewCompany: jest.fn().mockReturnValue(true),
    } as any,
  );
  return { service, attempts, evaluator, logged, row, official };
}

const approve = (extra: any = {}) => ({ decision: 'APPROVE' as const, reason: 'Evidence checked', reviewedFingerprint: 'fp-1', ...extra });

describe('status corrections are applied safely', () => {
  it('SC1. approving without a granted status is refused; nothing is written', async () => {
    const { service, attempts } = rig();
    await expect(service.decide('hr-1', 'reg-1', approve())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.decide('hr-1', 'reg-1', approve({ grantedStatus: 'LEAVE' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(attempts.flatMap((a) => a.updates)).toHaveLength(0);
  });

  it('SC2. a granted Present on an ordinary absent day is applied, with before/after audit in the transaction', async () => {
    const { service, attempts, evaluator, logged } = rig();
    const out = await service.decide('hr-1', 'reg-1', approve({ grantedStatus: 'PRESENT' }));
    expect(out).toMatchObject({ status: 'APPROVED', applicationStatus: 'APPLIED', proposedStatus: 'PRESENT' });
    expect(attempts).toHaveLength(1);
    expect(evaluator.reviseForApprovedCorrection).toHaveBeenCalledTimes(1);
    expect(attempts[0].audits).toEqual([
      expect.objectContaining({
        action: 'ATTENDANCE_OFFICIAL_REVISED',
        fromState: 'ABSENT',
        toState: 'PRESENT',
        beforeValue: expect.objectContaining({ status: 'ABSENT', revision: 0 }),
        afterValue: expect.objectContaining({ status: 'PRESENT', revision: 1 }),
        metadata: expect.objectContaining({ regularizationId: 'reg-1', grantedStatus: 'PRESENT' }),
      }),
    ]);
    // Not audited twice by the best-effort logger.
    expect(logged.filter((e) => e.action === 'ATTENDANCE_OFFICIAL_REVISED')).toHaveLength(0);
  });

  it('SC3. when the evaluator cannot settle the granted status, the attempt rolls back and the approval is held', async () => {
    const { service, attempts } = rig({ revisedTo: { status: 'ABSENT', evaluationState: 'NEEDS_REVIEW' } });
    const out = await service.decide('hr-1', 'reg-1', approve({ grantedStatus: 'PRESENT' }));
    expect(attempts).toHaveLength(2);
    // The first attempt threw after writing; in Postgres both writes roll back
    // (proved in the integration suite). The second records only the hold.
    expect(attempts[0].audits).toHaveLength(0);
    expect(attempts[1].updates).toEqual([
      expect.objectContaining({ status: 'APPROVED', applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: 'STATUS_NEEDS_EVIDENCE', proposedStatus: 'PRESENT' }),
    ]);
    expect(out).toMatchObject({ applicationStatus: 'REVIEW_REQUIRED' });
  });

  it.each([
    ['a leave day', { status: 'LEAVE', leaveRequestId: 'lv-1' }, 'STATUS_NOT_CORRECTABLE'],
    ['a holiday', { status: 'HOLIDAY' }, 'STATUS_NOT_CORRECTABLE'],
    ['a weekly off', { status: 'WEEKLY_OFF' }, 'STATUS_NOT_CORRECTABLE'],
    ['a half day of approved leave', { status: 'HALF_DAY', leaveRequestId: 'lv-2' }, 'STATUS_NOT_CORRECTABLE'],
  ])('SC4. %s is held, never re-statused', async (_label, over, reason) => {
    const base = rig().official;
    const { service, attempts, evaluator } = rig({ official: { ...base, ...over } });
    const out = await service.decide('hr-1', 'reg-1', approve({ grantedStatus: 'PRESENT' }));
    expect(out).toMatchObject({ applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: reason });
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
    expect(attempts.flatMap((a) => a.audits)).toHaveLength(0);
  });

  it('SC5. a day with no official result is held as not evaluated', async () => {
    const { service, evaluator } = rig({ official: null, row: { basedOnFingerprint: null } });
    const out = await service.decide('hr-1', 'reg-1', approve({ grantedStatus: 'HALF_DAY', reviewedFingerprint: undefined }));
    expect(out).toMatchObject({ applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: 'DAY_NOT_EVALUATED', proposedStatus: 'HALF_DAY' });
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('SC6. a finalized month holds the approval; the day is not touched', async () => {
    const { service, evaluator } = rig({ monthClose: { status: 'FINALIZED' } });
    const out = await service.decide('hr-1', 'reg-1', approve({ grantedStatus: 'PRESENT' }));
    expect(out).toMatchObject({ applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: 'MONTH_FINALIZED' });
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('SC7. a reviewer who saw older facts gets a stale conflict, and nothing is applied', async () => {
    const { service, attempts, evaluator } = rig();
    await expect(service.decide('hr-1', 'reg-1', approve({ grantedStatus: 'PRESENT', reviewedFingerprint: 'fp-old' }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CORRECTION_STALE' }),
    });
    expect(attempts[0].updates).toEqual([expect.objectContaining({ status: 'STALE_REVIEW_REQUIRED' })]);
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('SC8. a day already showing the granted status needs no change', async () => {
    const base = rig().official;
    const { service, evaluator } = rig({ official: { ...base, status: 'PRESENT' } });
    const out = await service.decide('hr-1', 'reg-1', approve({ grantedStatus: 'PRESENT' }));
    expect(out).toMatchObject({ applicationStatus: 'NOT_REQUIRED', applicationFailureReason: 'ATTENDANCE_ALREADY_MATCHES' });
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('SC9. rejecting keeps the official day exactly as it was', async () => {
    const { service, evaluator } = rig();
    const out = await service.decide('hr-1', 'reg-1', { decision: 'REJECT', reason: 'No evidence' });
    expect(out).toMatchObject({ status: 'REJECTED', applicationStatus: 'NOT_REQUIRED' });
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('SC10. a legacy OTHER request with no policy type stays review-only', async () => {
    const { service, evaluator } = rig({ row: { policyCorrectionType: null } });
    const out = await service.decide('hr-1', 'reg-1', approve());
    expect(out).toMatchObject({ applicationStatus: 'NOT_REQUIRED', applicationFailureReason: 'REVIEW_ONLY_REQUEST' });
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('SC11. applying a held status correction re-checks that the day settles, and stays held if not', async () => {
    const held = { status: 'APPROVED', applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: 'MONTH_FINALIZED', proposedStatus: 'PRESENT', decisionFingerprint: 'fp-1' };
    const ok = rig({ row: held });
    await expect(ok.service.applyHeld('hr-1', 'reg-1')).resolves.toMatchObject({ applicationStatus: 'APPLIED' });
    expect(ok.attempts[0].audits).toEqual([expect.objectContaining({ toState: 'PRESENT', metadata: expect.objectContaining({ grantedStatus: 'PRESENT' }) })]);

    const stuck = rig({ row: held, revisedTo: { status: 'ABSENT', evaluationState: 'NEEDS_REVIEW' } });
    await expect(stuck.service.applyHeld('hr-1', 'reg-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CORRECTION_STILL_BLOCKED', applicationFailureReason: 'STATUS_NEEDS_EVIDENCE' }),
    });
    expect(stuck.attempts[0].audits).toHaveLength(0);

    const leave = rig({ row: held, official: { ...rig().official, status: 'LEAVE', leaveRequestId: 'lv-1' } });
    await expect(leave.service.applyHeld('hr-1', 'reg-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CORRECTION_STILL_BLOCKED', applicationFailureReason: 'STATUS_NOT_CORRECTABLE' }),
    });
  });
});
