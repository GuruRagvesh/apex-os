/**
 * System alerts in the unified review queue, against a real PostgreSQL server.
 *
 * Real Prisma, the real append-only evidence triggers, the real audit table:
 *
 *   - historical PunchEvidenceReview rows appear under System Requests only
 *   - the default list, its total and the pending counts exclude them
 *   - Mark Reviewed / Dismiss change only the review rows, write an audit
 *     entry each, and leave punch evidence and the official day untouched
 *   - an employee or manager is refused at the API layer
 */

import { buildHarness, Harness, seedCompany, Seed, givenAttendance, DATE } from './harness';
import { TVAService } from '../../src/common/services/tva.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { CorrectionAuthorityService } from '../../src/modules/platform/attendance/regularization/correction-authority.service';
import { PunchReviewService } from '../../src/modules/platform/attendance/console/punch-review.service';
import { ReviewQueueService } from '../../src/modules/platform/review-queue/review-queue.service';

const DAY = new Date(`${DATE}T00:00:00.000Z`);

describe('Review queue system alerts (PostgreSQL)', () => {
  let h: Harness;
  let seed: Seed;
  let queue: ReviewQueueService;

  beforeAll(async () => {
    h = await buildHarness();
    const tva = h.moduleRef.get(TVAService);
    const access = h.moduleRef.get(AccessPolicyService);
    const events = h.moduleRef.get(EventLoggerService);
    const punchReviews = new PunchReviewService(h.prisma, tva, access, events);
    queue = new ReviewQueueService(
      h.prisma, new CorrectionAuthorityService(h.prisma, access), {} as any, {} as any, {} as any,
      punchReviews, {} as any, {} as any, {} as any, events,
    );
  });
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    seed = await seedCompany(h.prisma);
  });

  const B = () => seed.employees.B.id;
  const C = () => seed.employees.C.id;

  async function evidence(userId: string, type: 'PUNCH_IN' | 'PUNCH_OUT', hhmm: string, key: string) {
    return h.prisma.attendancePunchEvidence.create({
      data: { userId, type, businessDate: DAY, serverOccurredAt: new Date(`${DATE}T${hhmm}:00.000Z`), idempotencyKey: key, policyContextStatus: 'POLICY_SETUP_PENDING' } as any,
    });
  }
  async function alert(id: string, evidenceId: string, reasonCodes: string[]) {
    return h.prisma.punchEvidenceReview.create({ data: { id, evidenceId, reasonCodes } });
  }

  /** Two historical alerts for B on one day, one for C, and one ordinary correction. */
  async function scenario() {
    const inB = await evidence(B(), 'PUNCH_IN', '04:00', 'r3-b-in');
    const outB = await evidence(B(), 'PUNCH_OUT', '13:00', 'r3-b-out');
    const inC = await evidence(C(), 'PUNCH_IN', '04:30', 'r3-c-in');
    await alert('pr-b-in', inB.id, ['POLICY_SETUP_PENDING']);
    await alert('pr-b-out', outB.id, ['POLICY_SETUP_PENDING', 'DEVICE_ID_UNAVAILABLE']);
    await alert('pr-c-in', inC.id, ['ACCURACY_UNAVAILABLE']);
    const day = await givenAttendance(h.prisma, B(), DATE, { status: 'ABSENT', evaluationState: 'CALCULATED', calculationReason: 'NO_ATTENDANCE' });
    await h.prisma.attendanceRegularization.create({
      data: { userId: C(), date: DAY, requestType: 'MISSING_PUNCH', reason: 'Forgot to punch out', status: 'PENDING' } as any,
    });
    return { day, evidenceIds: [inB.id, outB.id, inC.id] };
  }

  const snapshot = async (evidenceIds: string[]) => ({
    evidence: await h.prisma.attendancePunchEvidence.findMany({ where: { id: { in: evidenceIds } }, orderBy: { id: 'asc' } }),
    daily: await h.prisma.dailyAttendance.findMany({ orderBy: { id: 'asc' } }),
    regularizations: await h.prisma.attendanceRegularization.findMany({ orderBy: { id: 'asc' } }),
    leaves: await h.prisma.leaveRequest.findMany({ orderBy: { id: 'asc' } }),
  });

  it('historical alerts appear only under System Requests, grouped by employee and date', async () => {
    await scenario();
    const hr = seed.actors.hr;

    const normal = await queue.list(hr, 'company');
    expect(normal.items.some((i) => i.origin === 'SYSTEM')).toBe(false);
    expect(normal.items.map((i) => i.requestType)).toEqual(['ATTENDANCE_CORRECTION']);
    expect(normal.total).toBe(1);

    const system = await queue.list(hr, 'company', 'system');
    expect(system.total).toBe(2);
    expect(system.items.every((i) => i.origin === 'SYSTEM' && i.requester === null && i.employee === null)).toBe(true);
    const b = system.items.find((i) => i.affectedEmployee?.id === B())!;
    expect(b.details).toMatchObject({ evidenceCount: 2, reviewIds: ['pr-b-in', 'pr-b-out'], businessDate: DATE });
    expect(b.reason).toBe('Attendance policy setup pending · Device ID unavailable');

    expect(await queue.counts(hr)).toMatchObject({ company: 1, system: 2 });
  });

  it('Mark Reviewed and Dismiss change only the alerts, audit each one, and leave attendance alone', async () => {
    const { evidenceIds } = await scenario();
    const before = await snapshot(evidenceIds);
    const hr = seed.actors.hr;

    await queue.decide(hr, 'PUNCH_EVIDENCE_REVIEW', 'pr-b-out', { action: 'MARK_REVIEWED' });
    await expect(queue.decide(hr, 'PUNCH_EVIDENCE_REVIEW', 'pr-c-in', { action: 'DISMISS' })).rejects.toThrow(/reason is required/);
    await queue.decide(hr, 'PUNCH_EVIDENCE_REVIEW', 'pr-c-in', { action: 'DISMISS', reason: 'Known GPS issue' });

    const rows = await h.prisma.punchEvidenceReview.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.id, r.status, r.reviewedById])).toEqual([
      ['pr-b-in', 'REVIEWED', hr.id],
      ['pr-b-out', 'REVIEWED', hr.id],
      ['pr-c-in', 'DISMISSED', hr.id],
    ]);
    expect(rows.every((r) => r.reviewedAt instanceof Date)).toBe(true);
    expect(rows.find((r) => r.id === 'pr-c-in')!.note).toBe('Known GPS issue');

    const audit = await (h.prisma as any).operationalEvent.findMany({ where: { entityType: 'PunchEvidenceReview' }, orderBy: { entityId: 'asc' } });
    expect(audit.map((e: any) => [e.entityId, e.actorId, e.toState])).toEqual([
      ['pr-b-in', hr.id, 'REVIEWED'],
      ['pr-b-out', hr.id, 'REVIEWED'],
      ['pr-c-in', hr.id, 'DISMISSED'],
    ]);
    expect(audit.find((e: any) => e.entityId === 'pr-c-in').metadata).toMatchObject({ note: 'Known GPS issue' });

    expect(await snapshot(evidenceIds)).toEqual(before);
    expect(await queue.counts(hr)).toMatchObject({ company: 1, system: 0 });
  });

  it('employees and managers cannot list or act on system alerts', async () => {
    await scenario();
    const employee = { id: seed.employees.A.id, role: { name: 'EMPLOYEE' } };
    await expect(queue.list(employee, 'company', 'system')).rejects.toThrow(/Only HR and administrators/);
    await expect(queue.decide(employee, 'PUNCH_EVIDENCE_REVIEW', 'pr-c-in', { action: 'MARK_REVIEWED' })).rejects.toThrow();
    expect((await h.prisma.punchEvidenceReview.findUnique({ where: { id: 'pr-c-in' } }))!.status).toBe('PENDING');
    expect((await queue.counts(employee)).system).toBe(0);
    // Admin is allowed.
    await expect(queue.list(seed.actors.admin, 'company', 'system')).resolves.toMatchObject({ total: 2 });
  });
});
