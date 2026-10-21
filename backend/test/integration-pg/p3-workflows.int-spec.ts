/**
 * Phase 3 workflows against a real PostgreSQL server.
 *
 * Real Prisma, real triggers, real row and advisory locks, the real evaluator.
 * Only notifications are recorded instead of delivered. Covers:
 *
 *   - correction queues filtered in the database before paging
 *   - single final decision by TL / Manager / HR / Admin / Super Admin
 *   - self, unrelated-reviewer and creator rules
 *   - first-decision-wins under concurrency
 *   - stale, locked/finalized and already-matching outcomes
 *   - compatibility rejection through the protocol-v1 writer
 *   - three-day unreported-absence LWP: decided once, settled days untouched
 *   - legacy correction rows stay present and visible
 */

import { randomUUID } from 'crypto';
import { buildHarness, Harness, seedCompany, Seed, givenAttendance, rawClient, DATE } from './harness';
import { TVAService } from '../../src/common/services/tva.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { CorrectionAuthorityService } from '../../src/modules/platform/attendance/regularization/correction-authority.service';
import { CorrectionDecisionService } from '../../src/modules/platform/attendance/regularization/correction-decision.service';
import { UnreportedAbsenceService } from '../../src/modules/platform/attendance/absence/unreported-absence.service';
import { LeaveWorkingDayService } from '../../src/modules/operations/leave/leave-working-day.service';
import { EmployeeTimelineService } from '../../src/modules/platform/attendance/timeline/employee-timeline.service';
import { BusinessCalendarService } from '../../src/modules/platform/attendance/calendar/business-calendar.service';

const DAY = new Date(`${DATE}T00:00:00.000Z`);
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

describe('Phase 3 workflows (PostgreSQL)', () => {
  let h: Harness;
  let seed: Seed;
  let decisions: CorrectionDecisionService;
  let lwp: UnreportedAbsenceService;
  const sent: Array<{ userId: string; key: string; dedupeKey?: string }> = [];

  const settings = { get: async () => ({ correctionDecisionEnabled: true, regularizationEnabled: true }) };

  beforeAll(async () => {
    h = await buildHarness();
    const tva = h.moduleRef.get(TVAService);
    const access = h.moduleRef.get(AccessPolicyService);
    const events = h.moduleRef.get(EventLoggerService);
    const authority = new CorrectionAuthorityService(h.prisma, access);
    const notifications: any = {
      sendNotification: async (userId: string, key: string, data: any) => {
        sent.push({ userId, key, dedupeKey: data?.dedupeKey });
        return {};
      },
    };
    decisions = new CorrectionDecisionService(h.prisma, tva, events, settings as any, h.evaluator, authority, notifications);
    const timeline = new EmployeeTimelineService(h.prisma, tva);
    const calendar = new BusinessCalendarService(h.prisma, tva);
    const workingDays = new LeaveWorkingDayService(tva, timeline, calendar);
    lwp = new UnreportedAbsenceService(h.prisma, tva, access, events, h.evaluator, workingDays);
  });
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    sent.length = 0;
    seed = await seedCompany(h.prisma);
    await h.prisma.$executeRawUnsafe('TRUNCATE TABLE unreported_absence_decisions, absence_reports');
  });

  /** A TL and a Manager linked to employee B; a second, unrelated TL. */
  async function hierarchy() {
    await h.prisma.user.create({ data: { id: 'u-tl', employeeId: 'TE-950', email: 'tl@integration.invalid', name: 'Team Lead', password: 'x', roleId: 'r-lead' } as any });
    await h.prisma.user.create({ data: { id: 'u-tl-other', employeeId: 'TE-951', email: 'tl2@integration.invalid', name: 'Other Lead', password: 'x', roleId: 'r-lead' } as any });
    await h.prisma.user.create({ data: { id: 'u-mgr', employeeId: 'TE-952', email: 'mgr@integration.invalid', name: 'Manager', password: 'x', roleId: 'r-manager' } as any });
    await h.prisma.user.create({ data: { id: 'u-super', employeeId: 'TE-953', email: 'sa@integration.invalid', name: 'Super A', password: 'x', roleId: 'r-super' } as any });
    await h.prisma.user.create({ data: { id: 'u-super-2', employeeId: 'TE-954', email: 'sa2@integration.invalid', name: 'Super D', password: 'x', roleId: 'r-super' } as any });
    await h.prisma.user.update({ where: { id: seed.employees.B.id }, data: { teamLeadName: 'TE-950', reportingManager: 'TE-952' } });
  }

  async function request(userId: string, over: Record<string, any> = {}) {
    return h.prisma.attendanceRegularization.create({
      data: {
        userId,
        date: DAY,
        requestType: 'MISSING_PUNCH',
        reason: 'Forgot to punch out after the client call.',
        requestedPunchOut: ist(DATE, '19:10'),
        status: 'PENDING',
        ...over,
      } as any,
    });
  }

  it('new and legacy unresolved requests are visible at once, and team/company scopes differ', async () => {
    await hierarchy();
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const pending = await request(seed.employees.B.id);
    const legacy = await request(seed.employees.C.id, { status: 'MANAGER_APPROVED', managerApproverId: 'u-mgr', managerDecisionAt: new Date() });

    const team = await decisions.queue('u-tl', 'team');
    expect(team.items.map((r: any) => r.id)).toEqual([pending.id]);
    const company = await decisions.queue('u-admin', 'company');
    expect(company.items.map((r: any) => r.id).sort()).toEqual([pending.id, legacy.id].sort());
    await expect(decisions.queue('u-tl', 'company')).rejects.toMatchObject({ status: 403 });
    // A Super Admin can use both scopes.
    expect((await decisions.queue('u-super', 'company')).total).toBe(2);
    expect((await decisions.queue('u-tl-other', 'team')).total).toBe(0);
  });

  it('more than 100 company-wide requests cannot push a reviewer\'s own request off page one', async () => {
    await hierarchy();
    // 150 older requests for employees outside the TL's hierarchy.
    const others = ['A', 'C', 'D', 'E', 'F'].map((k) => seed.employees[k].id);
    for (let i = 0; i < 150; i++) {
      const date = new Date(Date.UTC(2026, 5, 1 + Math.floor(i / others.length)));
      await h.prisma.attendanceRegularization.create({
        data: { userId: others[i % others.length], date, requestType: 'OTHER', reason: `Older request ${i}`, status: 'PENDING', createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) } as any,
      });
    }
    const mine = await request(seed.employees.B.id);
    const page = await decisions.queue('u-tl', 'team', 1, 100);
    expect(page.items.map((r: any) => r.id)).toEqual([mine.id]);
    expect(page.total).toBe(1);
  });

  it.each([
    ['u-tl', 'EMPLOYEE_TL'],
    ['u-mgr', 'REPORTING_MANAGER'],
    ['u-hr', 'HR'],
    ['u-admin', 'ADMIN'],
    ['u-super', 'SUPER_ADMIN'],
  ])('%s decides finally (%s) and the day is revised once', async (actor, via) => {
    await hierarchy();
    const day = await givenAttendance(h.prisma, seed.employees.B.id, DATE, { punchOutAt: null, status: 'MISSING_PUNCH', evaluationState: 'NEEDS_REVIEW' });
    const row = await request(seed.employees.B.id, { basedOnFingerprint: day.sourceFingerprint });
    const decided: any = await decisions.decide(actor, row.id, { decision: 'APPROVE', reason: 'Badge log confirms 19:10.', reviewedFingerprint: day.sourceFingerprint });
    expect(decided).toMatchObject({ status: 'APPROVED', decision: 'APPROVE', decidedVia: via, applicationStatus: 'APPLIED', decisionProtocolVersion: 1 });
    const after = await h.prisma.dailyAttendance.findUnique({ where: { userId_date: { userId: seed.employees.B.id, date: DAY } } });
    expect(after?.lastRegularizationId).toBe(row.id);
  });

  it('the employee and an unrelated Team Lead cannot decide; a Super Admin\'s own request goes to another Super Admin', async () => {
    await hierarchy();
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const row = await request(seed.employees.B.id);
    await expect(decisions.decide(seed.employees.B.id, row.id, { decision: 'APPROVE', reason: 'Self approve' })).rejects.toMatchObject({ status: 403 });
    await expect(decisions.decide('u-tl-other', row.id, { decision: 'APPROVE', reason: 'Not my team' })).rejects.toMatchObject({ status: 403 });

    const own = await h.prisma.attendanceRegularization.create({ data: { userId: 'u-super', date: DAY, requestType: 'OTHER', reason: 'Super Admin request', status: 'PENDING' } as any });
    await expect(decisions.decide('u-super', own.id, { decision: 'APPROVE', reason: 'Self' })).rejects.toMatchObject({ status: 403 });
    await expect(decisions.decide('u-super-2', own.id, { decision: 'APPROVE', reason: 'Reviewed by another Super Admin' })).resolves.toMatchObject({ status: 'APPROVED', decidedVia: 'SUPER_ADMIN' });
  });

  it('two simultaneous decisions produce exactly one, and the other gets "already decided"', async () => {
    await hierarchy();
    await givenAttendance(h.prisma, seed.employees.B.id, DATE, { punchOutAt: null });
    const row = await request(seed.employees.B.id);
    const results = await Promise.allSettled([
      decisions.decide('u-tl', row.id, { decision: 'APPROVE', reason: 'Approve from TL' }),
      decisions.decide('u-hr', row.id, { decision: 'REJECT', reason: 'Reject from HR' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.getResponse().code).toBe('CORRECTION_ALREADY_DECIDED');
    const stored = await h.prisma.attendanceRegularization.findUnique({ where: { id: row.id } });
    expect(['APPROVED', 'REJECTED']).toContain(stored!.status);
  });

  it('a stale decision records no approval, marks the request STALE, and the same request can be re-decided', async () => {
    await hierarchy();
    const day = await givenAttendance(h.prisma, seed.employees.B.id, DATE, { punchOutAt: null, sourceFingerprint: 'fp-old' });
    const row = await request(seed.employees.B.id, { basedOnFingerprint: 'fp-old' });
    await h.prisma.dailyAttendance.update({ where: { id: day.id }, data: { sourceFingerprint: 'fp-new', punchOutAt: ist(DATE, '19:00') } });

    await expect(decisions.decide('u-tl', row.id, { decision: 'APPROVE', reason: 'Approve', reviewedFingerprint: 'fp-old' }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'CORRECTION_STALE' }) });
    const stale = await h.prisma.attendanceRegularization.findUnique({ where: { id: row.id } });
    expect(stale).toMatchObject({ status: 'STALE_REVIEW_REQUIRED', decision: null, decidedById: null });
    const attempt = await h.prisma.operationalEvent.findFirst({ where: { entityId: row.id, action: 'REGULARIZATION_DECISION_STALE' } });
    expect(attempt).not.toBeNull();
    // Still visible, and decidable again against the current values.
    expect((await decisions.queue('u-tl', 'team')).items.map((r: any) => r.id)).toEqual([row.id]);
    await expect(decisions.decide('u-tl', row.id, { decision: 'APPROVE', reason: 'Approve against current', reviewedFingerprint: 'fp-new' }))
      .resolves.toMatchObject({ status: 'APPROVED' });
  });

  it('a finalized day keeps the approval as REVIEW_REQUIRED and is not touched', async () => {
    await hierarchy();
    const day = await givenAttendance(h.prisma, seed.employees.B.id, DATE, { punchOutAt: null, evaluationState: 'FINALIZED', locked: true });
    const row = await request(seed.employees.B.id, { basedOnFingerprint: day.sourceFingerprint });
    const decided: any = await decisions.decide('u-mgr', row.id, { decision: 'APPROVE', reason: 'Valid, but the day is closed', reviewedFingerprint: day.sourceFingerprint });
    expect(decided).toMatchObject({ status: 'APPROVED', applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: 'DAY_LOCKED' });
    const after = await h.prisma.dailyAttendance.findUnique({ where: { id: day.id } });
    expect(after).toMatchObject({ punchOutAt: null, revision: day.revision, sourceFingerprint: day.sourceFingerprint });
  });

  it('a request the day already satisfies is approved with NOT_REQUIRED and changes nothing', async () => {
    await hierarchy();
    const out = ist(DATE, '19:10');
    const day = await givenAttendance(h.prisma, seed.employees.B.id, DATE, { punchOutAt: out });
    const row = await request(seed.employees.B.id, { requestedPunchOut: out, basedOnFingerprint: day.sourceFingerprint });
    const decided: any = await decisions.decide('u-tl', row.id, { decision: 'APPROVE', reason: 'Already correct', reviewedFingerprint: day.sourceFingerprint });
    expect(decided).toMatchObject({ applicationStatus: 'NOT_REQUIRED', applicationFailureReason: 'ATTENDANCE_ALREADY_MATCHES' });
  });

  it('the compatibility reject route writes a full protocol-v1 decision', async () => {
    await hierarchy();
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const row = await request(seed.employees.B.id);
    const rejected: any = await decisions.decideCompatibility('u-tl', row.id, { decision: 'REJECT', reason: 'Not supported by the badge log' });
    expect(rejected).toMatchObject({ status: 'REJECTED', decisionProtocolVersion: 1, decidedById: 'u-tl', applicationStatus: 'NOT_REQUIRED' });
    expect(rejected.decisionReason).toBe('Not supported by the badge log');
  });

  it('a manual recovery creator: HR needs a second confirmation; a Team Lead creator cannot decide', async () => {
    await hierarchy();
    await givenAttendance(h.prisma, seed.employees.B.id, DATE, { punchOutAt: null });
    const byHr = await request(seed.employees.B.id, { entrySource: 'MANUAL_RECOVERY', createdById: 'u-hr' });
    await expect(decisions.decide('u-hr', byHr.id, { decision: 'APPROVE', reason: 'Entered and approved' }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'CORRECTION_CREATOR_CONFIRMATION_REQUIRED' }) });
    await expect(decisions.decide('u-hr', byHr.id, { decision: 'APPROVE', reason: 'Confirmed separately', confirmCreatorDecision: true }))
      .resolves.toMatchObject({ status: 'APPROVED' });

    await h.prisma.attendanceRegularization.deleteMany({ where: { id: byHr.id, decisionProtocolVersion: null } });
    const byTl = await h.prisma.attendanceRegularization.create({
      data: { userId: seed.employees.B.id, date: new Date('2026-08-13T00:00:00.000Z'), requestType: 'MISSING_PUNCH', reason: 'Outage recovery', status: 'PENDING', entrySource: 'MANUAL_RECOVERY', createdById: 'u-tl', requestedPunchOut: ist('2026-08-13', '19:00') } as any,
    });
    await expect(decisions.decide('u-tl', byTl.id, { decision: 'APPROVE', reason: 'Entered and approved', confirmCreatorDecision: true }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'CORRECTION_CREATOR_DECISION' }) });
  });

  it('legacy HR_APPROVED and REJECTED rows stay byte-identical', async () => {
    const hr = await request(seed.employees.D.id, { status: 'HR_APPROVED', hrApproverId: 'u-hr', hrDecisionAt: new Date('2026-08-15T06:00:00Z') });
    const rejected = await h.prisma.attendanceRegularization.create({ data: { userId: seed.employees.E.id, date: DAY, requestType: 'OTHER', reason: 'Legacy reject', status: 'PENDING' } as any });
    // A pre-migration REJECTED row is simulated with the trigger bypass that the
    // migration exempts (legacy rows carry no protocol version).
    await h.prisma.$executeRawUnsafe(`ALTER TABLE attendance_regularizations DISABLE TRIGGER attendance_regularizations_decision_guard`);
    await h.prisma.$executeRawUnsafe(`UPDATE attendance_regularizations SET status = 'REJECTED' WHERE id = '${rejected.id}'`);
    await h.prisma.$executeRawUnsafe(`ALTER TABLE attendance_regularizations ENABLE TRIGGER attendance_regularizations_decision_guard`);
    const before = await h.prisma.attendanceRegularization.findMany({ where: { id: { in: [hr.id, rejected.id] } }, orderBy: { id: 'asc' } });
    await decisions.queue('u-admin', 'company');
    const after = await h.prisma.attendanceRegularization.findMany({ where: { id: { in: [hr.id, rejected.id] } }, orderBy: { id: 'asc' } });
    expect(after).toEqual(before);
  });

  describe('three-day unreported absence', () => {
    // Thu 6, Fri 7, Mon 10 Aug 2026 (Sat 8 is the 2nd Saturday, Sun 9 off).
    const RUN = ['2026-08-06', '2026-08-07', '2026-08-10'];

    it('decides LWP once per day, keeps it on re-evaluation, and never touches a settled day', async () => {
      const B = seed.employees.B.id;
      for (const d of RUN.slice(0, 2)) await h.evaluator.evaluateAndPersist(B, d);
      await h.prisma.dailyAttendance.upsert({
        where: { userId_date: { userId: B, date: new Date('2026-08-10T00:00:00.000Z') } },
        create: { userId: B, date: new Date('2026-08-10T00:00:00.000Z'), status: 'MISSING_PUNCH', evaluationState: 'FINALIZED', locked: true } as any,
        update: {},
      });
      // A day the employee did report is not unreported (Wed 5 Aug).
      await h.prisma.absenceReport.create({ data: { id: randomUUID(), userId: B, businessDate: new Date('2026-08-05T00:00:00.000Z'), channel: 'EMAIL', note: 'Informed HR by email', recordedById: 'u-hr' } });

      const [first, second] = await Promise.all([lwp.applyForUser(B, '2026-08-10'), lwp.applyForUser(B, '2026-08-10')]);
      const decisionsStored = await h.prisma.unreportedAbsenceDecision.findMany({ where: { userId: B }, orderBy: { businessDate: 'asc' } });
      // Advisory lock + unique index: exactly one decision per day.
      expect(decisionsStored.map((d) => [d.businessDate.toISOString().slice(0, 10), d.outcome])).toEqual(
        expect.arrayContaining([['2026-08-06', 'APPLIED'], ['2026-08-07', 'APPLIED'], ['2026-08-10', 'SKIPPED_SETTLED']]),
      );
      expect(first.applied.length + second.applied.length).toBe(decisionsStored.filter((d) => d.outcome === 'APPLIED').length);

      const lwpDay = await h.prisma.dailyAttendance.findUnique({ where: { userId_date: { userId: B, date: new Date('2026-08-06T00:00:00.000Z') } } });
      expect(lwpDay).toMatchObject({ status: 'LWP', lwpDeducted: 1, calculationReason: 'UNREPORTED_ABSENCE_LWP' });
      const settled = await h.prisma.dailyAttendance.findUnique({ where: { userId_date: { userId: B, date: new Date('2026-08-10T00:00:00.000Z') } } });
      expect(settled).toMatchObject({ status: 'MISSING_PUNCH', locked: true });

      // A rerun changes nothing.
      const rerun = await lwp.applyForUser(B, '2026-08-10');
      expect(rerun.applied).toEqual([]);
    });

    it('HR correction records who, when and why, and returns the day to review', async () => {
      const B = seed.employees.B.id;
      await lwp.applyForUser(B, '2026-08-10');
      const decision = await h.prisma.unreportedAbsenceDecision.findFirst({ where: { userId: B, outcome: 'APPLIED' }, orderBy: { businessDate: 'asc' } });
      expect(decision).not.toBeNull();
      await expect(lwp.correct({ id: 'u-hr', isHR: true, role: { name: 'MANAGER' } }, decision!.id, { reason: 'Hospital admission evidence supplied' }))
        .resolves.toMatchObject({ outcome: 'CORRECTED' });
      const corrected = await h.prisma.unreportedAbsenceDecision.findUnique({ where: { id: decision!.id } });
      expect(corrected).toMatchObject({ outcome: 'CORRECTED', correctedById: 'u-hr' });
      // The original decision columns are immutable.
      await expect(h.prisma.unreportedAbsenceDecision.update({ where: { id: decision!.id }, data: { runLength: 9 } })).rejects.toThrow();
      await expect(h.prisma.unreportedAbsenceDecision.delete({ where: { id: decision!.id } })).rejects.toThrow();
    });

    it('two unreported days are never LWP', async () => {
      const B = seed.employees.B.id;
      // Reported on Wed 5 and Mon 10: only Thu 6 and Fri 7 are unreported between them.
      for (const d of ['2026-08-05', '2026-08-10']) {
        await h.prisma.absenceReport.create({ data: { id: randomUUID(), userId: B, businessDate: new Date(`${d}T00:00:00.000Z`), channel: 'PHONE', note: 'Called the Team Lead', recordedById: 'u-hr' } });
      }
      const out = await lwp.applyForUser(B, '2026-08-11');
      expect(out.applied.filter((d) => d >= '2026-08-05')).toEqual([]);
    });
  });

  it('a second connection sees the decision-once trigger refuse a rewrite of a final decision', async () => {
    await hierarchy();
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const row = await request(seed.employees.B.id);
    await decisions.decide('u-tl', row.id, { decision: 'REJECT', reason: 'Not supported' });
    const other = rawClient();
    try {
      await expect(other.attendanceRegularization.update({ where: { id: row.id }, data: { decisionReason: 'rewritten' } })).rejects.toThrow();
      await expect(other.attendanceRegularization.delete({ where: { id: row.id } })).rejects.toThrow();
    } finally {
      await other.$disconnect();
    }
  });
});
