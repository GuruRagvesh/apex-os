import { ReviewQueueService } from '../../src/modules/platform/review-queue/review-queue.service';
import { makeRawSqlDouble } from '../helpers/raw-sql-double';

function makeService(overrides: { prisma?: any; corrections?: any } = {}) {
  const prisma = overrides.prisma ?? {};
  const corrections = overrides.corrections ?? {};
  const service = new ReviewQueueService(
    prisma,
    {} as any,
    corrections,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
  );
  return { service, prisma, corrections };
}

describe('ReviewQueueService', () => {
  it('takes the forwarding advisory lock with executeRaw so PostgreSQL void is not deserialized', async () => {
    const raw = makeRawSqlDouble();
    const tx = {
      ...raw,
      reviewQueueAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
      },
    };
    const prisma = { $transaction: jest.fn((work: (client: any) => unknown) => work(tx)) };
    const { service } = makeService({ prisma });
    jest.spyOn(service as any, 'authorizedItem').mockResolvedValue({
      id: 'correction-1',
      requestType: 'ATTENDANCE_CORRECTION',
      subjectUserId: 'employee-1',
      details: {},
    });
    jest.spyOn(service, 'forwardCandidates').mockResolvedValue({
      items: [{ id: 'reviewer-2', name: 'Reviewer Two', employeeId: null, role: 'ADMIN', department: null }],
    });

    await expect(service.forward(
      { id: 'reviewer-1' },
      'ATTENDANCE_CORRECTION',
      'correction-1',
      { reviewerId: 'reviewer-2', reason: 'Please review' },
    )).resolves.toMatchObject({ forwarded: true });

    expect(raw.$executeRaw).toHaveBeenCalledTimes(1);
    expect(raw.$queryRaw).not.toHaveBeenCalled();
    expect(raw.statements[0]).toContain('pg_advisory_xact_lock');
  });

  it('uses the compatibility decision writer when the correction workflow flag is off', async () => {
    const corrections = {
      enabled: jest.fn().mockResolvedValue(false),
      decide: jest.fn(),
      decideCompatibility: jest.fn().mockResolvedValue({ status: 'APPROVED', decisionProtocolVersion: 1 }),
    };
    const prisma = {
      reviewQueueAssignment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const { service } = makeService({ prisma, corrections });
    jest.spyOn(service as any, 'authorizedItem').mockResolvedValue({
      id: 'correction-1',
      requestType: 'ATTENDANCE_CORRECTION',
      subjectUserId: 'employee-1',
      details: { currentFingerprint: 'fingerprint-1' },
    });

    await expect(service.decide(
      { id: 'reviewer-1' },
      'ATTENDANCE_CORRECTION',
      'correction-1',
      { decision: 'APPROVE', reason: 'Looks correct' },
    )).resolves.toMatchObject({ status: 'APPROVED' });

    expect(corrections.decide).not.toHaveBeenCalled();
    expect(corrections.decideCompatibility).toHaveBeenCalledWith('reviewer-1', 'correction-1', {
      decision: 'APPROVE',
      reason: 'Looks correct',
      reviewedFingerprint: 'fingerprint-1',
      confirmCreatorDecision: false,
    });
  });
});
