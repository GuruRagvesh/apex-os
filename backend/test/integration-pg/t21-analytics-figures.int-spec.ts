/**
 * Phase 6E: Analytics figures against real PostgreSQL.
 *
 * Every expected number below is worked out by hand from the rows seeded
 * here, not from the code under test.
 *
 * Before the fix:
 *  - the Review backlog and Home "pending reviews" counted every REVIEW ticket
 *    in the company, and Command Center "Pending Approvals" every pending
 *    leave request in the company, whoever asked;
 *  - "week"/"month" were server-clock windows and the ticket trend filed
 *    00:00-05:30 IST under the previous (UTC) day;
 *  - SLA "on time" compared logged work hours with the SLA hours, so a ticket
 *    delivered late with little work logged counted as on time;
 *  - rework breakdowns were hard-coded empty lists;
 *  - no figure could be asked for a date range, a project or per employee.
 *
 * Company timezone: Asia/Kolkata (UTC+5:30). "Now" is 2026-10-07 11:30 IST.
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { TVAService } from '../../src/common/services/tva.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { HierarchyApprovalService } from '../../src/common/services/hierarchy-approval.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { TicketTimingService } from '../../src/common/services/ticket-timing.service';
import { LeaveAccessService } from '../../src/common/services/leave-access.service';
import { AnalyticsService } from '../../src/modules/platform/analytics/analytics.service';
import { DashboardService } from '../../src/modules/platform/dashboard/dashboard.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';

const NOW = new Date('2026-10-07T06:00:00.000Z');
const DA = 'd-t21-a';
const DB = 'd-t21-b';
const ADM = 'u-t21-admin';
const MGR = 'u-t21-manager';
const TL = 'u-t21-lead';
const E1 = 'u-t21-e1';
const E2 = 'u-t21-e2';
const EB = 'u-t21-eb';
const ROLE_OF: Record<string, string> = { [ADM]: 'ADMIN', [MGR]: 'MANAGER', [TL]: 'TEAM_LEAD', [E1]: 'EMPLOYEE', [E2]: 'EMPLOYEE', [EB]: 'EMPLOYEE' };
const DEPT_OF: Record<string, string | null> = { [ADM]: null, [MGR]: DB, [TL]: DA, [E1]: DA, [E2]: DA, [EB]: DB };
const actor = (id: string) => ({ id, role: { name: ROLE_OF[id] }, departmentId: DEPT_OF[id], isHR: false });
const at = (iso: string) => new Date(iso);

async function status(p: Promise<unknown>): Promise<number> {
  try { await p; return 200; } catch (e: any) { return typeof e?.getStatus === 'function' ? e.getStatus() : 500; }
}

describe('T21 analytics figures, scope and company dates (PostgreSQL)', () => {
  let prisma: PrismaService;
  let analytics: AnalyticsService;
  let dashboard: DashboardService;

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);

    const tva = new TVAService({ get: () => undefined } as any);
    jest.spyOn(tva, 'now').mockImplementation(() => new Date(NOW));
    const access = new AccessPolicyService(prisma);
    const ticketAccess = new TicketAccessService(prisma, access, new HierarchyApprovalService(prisma));
    const timing = new TicketTimingService(prisma, tva);
    const leaveAccess = new LeaveAccessService(prisma, access);
    analytics = new AnalyticsService(prisma, ticketAccess, timing, access, tva, leaveAccess);
    dashboard = new DashboardService(prisma, ticketAccess, timing, leaveAccess, access, {} as any, tva);

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE tickets, projects, leave_requests, work_sessions, task_types, users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma.department.createMany({ data: [{ id: DA, name: 'T21 A' }, { id: DB, name: 'T21 B' }] as any });
    const roleIds: Record<string, string> = {};
    for (const [name, level] of [['ADMIN', 1], ['MANAGER', 2], ['TEAM_LEAD', 3], ['EMPLOYEE', 4]] as const) {
      roleIds[name] = (await prisma.role.create({ data: { id: `r-t21-${name.toLowerCase()}`, name, level } as any })).id;
    }
    for (const id of Object.keys(ROLE_OF)) {
      await prisma.user.create({ data: { id, roleId: roleIds[ROLE_OF[id]], name: id, departmentId: DEPT_OF[id], email: `${id}@integration.invalid`, password: 'x', currentStatus: 'OFFLINE' } as any });
    }
    await prisma.taskType.create({ data: { id: 'tt-t21-design', name: 'Design' } as any });
    await prisma.project.create({ data: { id: 'p-t21-a', projectId: 'PRJ-T21-A', name: 'Project A', departmentId: DA, members: { create: [{ userId: E1 }] } } as any });
    await prisma.project.create({ data: { id: 'p-t21-b', projectId: 'PRJ-T21-B', name: 'Project B', departmentId: DB } as any });

    const ticket = (id: string, data: any) => prisma.ticket.create({
      data: { id, ticketId: id.toUpperCase(), title: id, category: 'IT', type: 'TASK', priority: 'MEDIUM', ...data, createdById: data.assignedToId } as any,
    });
    // T1: E1, project A, due 10:00Z, first submitted 09:00Z (on time), completed 2026-10-05 12:00Z.
    await ticket('t21-1', { status: 'DONE', assignedToId: E1, departmentId: DA, projectId: 'p-t21-a', executionDueAt: at('2026-10-05T10:00:00Z'), actualCompletedAt: at('2026-10-05T12:00:00Z'), resolvedAt: at('2026-10-05T12:00:00Z') });
    // T2: E1, no project, due 10:00Z, first submitted 11:00Z (late, almost no work), completed 2026-10-05 14:00Z.
    await ticket('t21-2', { status: 'DONE', assignedToId: E1, departmentId: DA, executionDueAt: at('2026-10-05T10:00:00Z'), actualCompletedAt: at('2026-10-05T14:00:00Z'), resolvedAt: at('2026-10-05T14:00:00Z') });
    // T3: EB in department B, waiting for review.
    await ticket('t21-3', { status: 'REVIEW', assignedToId: EB, departmentId: DB, projectId: 'p-t21-b', reviewDueAt: at('2026-10-08T00:00:00Z') });
    // T4: E2 in department A, waiting for review.
    await ticket('t21-4', { status: 'REVIEW', assignedToId: E2, departmentId: DA, reviewDueAt: at('2026-10-08T00:00:00Z') });
    // T5: E1, closed after two reworks, task type Design, no due basis at all.
    await ticket('t21-5', { status: 'CLOSED', assignedToId: E1, departmentId: DA, reworkCount: 2, taskTypeId: 'tt-t21-design', closedAt: at('2026-10-06T08:00:00Z') });
    // T6: created 2026-10-06 19:00Z = 2026-10-07 00:30 IST.
    await ticket('t21-6', { status: 'OPEN', assignedToId: E2, departmentId: DA });
    await prisma.$executeRawUnsafe(`UPDATE tickets SET "createdAt" = $1`, at('2026-10-01T06:00:00Z'));
    await prisma.$executeRawUnsafe(`UPDATE tickets SET "createdAt" = $1 WHERE id = 't21-6'`, at('2026-10-06T19:00:00Z'));

    const cycle = (ticketId: string, cycleNo: number, createdAt: string, decision: string, endedAt: string) =>
      prisma.reviewCycleLog.create({ data: { ticketId, cycleNo, assigneeId: E1, reviewerId: TL, decision, createdAt: at(createdAt), reviewStartedAt: at(createdAt), reviewEndedAt: at(endedAt) } as any });
    await cycle('t21-1', 1, '2026-10-05T09:00:00Z', 'APPROVED', '2026-10-05T09:30:00Z');
    await cycle('t21-2', 1, '2026-10-05T11:00:00Z', 'REWORK', '2026-10-05T11:30:00Z');
    await cycle('t21-2', 2, '2026-10-05T13:00:00Z', 'APPROVED', '2026-10-05T13:30:00Z');
    await cycle('t21-5', 1, '2026-10-06T05:00:00Z', 'REWORK', '2026-10-06T05:10:00Z');
    await cycle('t21-5', 2, '2026-10-06T06:00:00Z', 'REWORK', '2026-10-06T06:10:00Z');
    // QC ratings the reviewer gave: T1 4/5/3, T2 cycle 1 2/3/4; T2 cycle 2 left unrated.
    await prisma.reviewCycleLog.updateMany({ where: { ticketId: 't21-1', cycleNo: 1 }, data: { taskEfficiencyRating: 4, employeePerformanceRating: 5, employeeAttitudeRating: 3 } });
    await prisma.reviewCycleLog.updateMany({ where: { ticketId: 't21-2', cycleNo: 1 }, data: { taskEfficiencyRating: 2, employeePerformanceRating: 3, employeeAttitudeRating: 4 } });

    const log = (ticketId: string, userId: string, ownerType: string, stage: string, s: string, e: string) => prisma.ticketTimeLog.create({
      data: { ticketId, userId, ownerType, stage, source: 'SYSTEM', startedAt: at(s), endedAt: at(e), durationSeconds: Math.round((at(e).getTime() - at(s).getTime()) / 1000), countsAsWork: true } as any,
    });
    // 18:00Z-19:00Z on 10-04 = 23:30-00:30 IST: 1800 s on 10-04 and 1800 s on 10-05.
    await log('t21-1', E1, 'ASSIGNEE', 'WORK', '2026-10-04T18:00:00Z', '2026-10-04T19:00:00Z');
    // 600 s on 10-05.
    await log('t21-2', E1, 'ASSIGNEE', 'WORK', '2026-10-05T05:00:00Z', '2026-10-05T05:10:00Z');
    // Reviewer time for TL: 900 s on 10-05. Never added to productive time.
    await log('t21-1', TL, 'REVIEWER', 'REVIEW', '2026-10-05T09:00:00Z', '2026-10-05T09:15:00Z');

    // E1's workday on 10-05: 09:00-18:00 IST with a 60-minute break = 480 minutes.
    await prisma.workSession.create({ data: { userId: E1, date: at('2026-10-05T00:00:00Z'), startWorkAt: at('2026-10-05T03:30:00Z'), logoutAt: at('2026-10-05T12:30:00Z'), status: 'LOGGED_OUT', totalWorkMinutes: 480, totalBreakMinutes: 60 } as any });

    const leave = (userId: string) => prisma.leaveRequest.create({ data: { userId, type: 'CASUAL', startDate: at('2026-10-20T00:00:00Z'), endDate: at('2026-10-20T00:00:00Z'), reason: 't21', status: 'PENDING' } as any });
    await leave(E2);
    await leave(EB);
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE tickets, projects, leave_requests, work_sessions, task_types, users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  describe('scope of counts that used to be company-wide', () => {
    it('Review backlog: a Team Lead sees only their department; an admin sees all', async () => {
      expect((await analytics.getReviewerMetrics(TL, actor(TL))).pendingApprovalsCount).toBe(1);
      expect((await analytics.getReviewerMetrics(ADM, actor(ADM))).pendingApprovalsCount).toBe(2);
      expect((await analytics.getReviewerMetrics(E1, actor(E1))).pendingApprovalsCount).toBe(0);
    });

    it('Command Center pending leave follows the leave scope', async () => {
      expect((await analytics.getCommandCenter(actor(TL), 'today')).pendingApprovals).toBe(1);
      expect((await analytics.getCommandCenter(actor(ADM), 'today')).pendingApprovals).toBe(2);
    });

    it('Command Center current counts do not depend on the period', async () => {
      for (const p of ['today', 'week', 'month'] as const) {
        const cc = await analytics.getCommandCenter(actor(TL), p);
        expect(cc.activeReviews).toBe(1);
      }
    });

    it('Command Center period counts use company midnight', async () => {
      // Today (07 Oct IST) starts 2026-10-06 18:30Z: only T6 was created since.
      expect((await analytics.getCommandCenter(actor(ADM), 'today')).createdInPeriod).toBe(1);
      expect((await analytics.getCommandCenter(actor(ADM), 'week')).completedInPeriod).toBe(3);
    });

    it('Home "pending reviews" is scoped too', async () => {
      const summary: any = await (dashboard as any).getApprovalWorkload(actor(TL));
      expect(summary.pendingReviews).toBe(1);
    });
  });

  describe('company dates', () => {
    it('the ticket trend files 00:30 IST under its IST date', async () => {
      const trend = await dashboard.getTicketTrend(3, actor(ADM));
      expect(trend.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
      expect(trend.find((d) => d.date === '2026-10-07')!.created).toBe(1);
      expect(trend.find((d) => d.date === '2026-10-06')!.created).toBe(0);
    });

    it('overview reports closed tickets so totals reconcile', async () => {
      const o: any = await dashboard.getOverview(actor(ADM));
      expect(o.stats.totalTickets).toBe(6);
      expect(o.stats.doneTickets).toBe(2);
      expect(o.stats.closedTickets).toBe(1);
    });
  });

  describe('productivity over a range', () => {
    it('splits productive time across IST days and clips to the range', async () => {
      const r: any = await analytics.getProductivity(actor(ADM), { from: '2026-10-04', to: '2026-10-05', userId: E1 });
      expect(r.daily).toEqual([
        { date: '2026-10-04', productiveSeconds: 1800, workdaySeconds: 0, ticketsCompleted: 0 },
        { date: '2026-10-05', productiveSeconds: 2400, workdaySeconds: 480 * 60, ticketsCompleted: 2 },
      ]);
      expect(r.totals).toMatchObject({ productiveSeconds: 4200, workdaySeconds: 480 * 60, ticketsCompleted: 2, approvals: 2, reworks: 1, reviewerSeconds: 0 });
      // Quality (QC points): averages over the two rated reviews only.
      expect(r.totals.quality).toEqual({ ratedReviews: 2, taskEfficiency: 3, performance: 4, attitude: 3.5 });
      expect(r.employees[0].quality.ratedReviews).toBe(2);
      const oneDay: any = await analytics.getProductivity(actor(ADM), { from: '2026-10-05', to: '2026-10-05', userId: E1 });
      expect(oneDay.totals.productiveSeconds).toBe(2400);
    });

    it('reviewer active time is its own column, never productive time', async () => {
      const r: any = await analytics.getProductivity(actor(ADM), { from: '2026-10-05', to: '2026-10-05', userId: TL });
      expect(r.totals).toMatchObject({ reviewerSeconds: 900, productiveSeconds: 0 });
    });

    it('a project filter keeps only that project\'s tickets; workday time stays per person', async () => {
      const r: any = await analytics.getProductivity(actor(ADM), { from: '2026-10-04', to: '2026-10-05', userId: E1, projectId: 'p-t21-a' });
      expect(r.project).toMatchObject({ id: 'p-t21-a', name: 'Project A' });
      expect(r.totals).toMatchObject({ productiveSeconds: 3600, ticketsCompleted: 1, approvals: 1, reworks: 0 });
      expect(r.workdayTimeIsPerPerson).toBe(true);
    });

    it('employees see only themselves; leads only their department; nobody reaches outside', async () => {
      const self: any = await analytics.getProductivity(actor(E1), { from: '2026-10-05', to: '2026-10-05' });
      expect(self.scope).toBe('self');
      expect(self.employees.map((e: any) => e.userId)).toEqual([E1]);
      const team: any = await analytics.getProductivity(actor(TL), { from: '2026-10-05', to: '2026-10-05' });
      expect(team.employees.map((e: any) => e.userId).sort()).toEqual([E1, E2, TL].sort());
      expect(await status(analytics.getProductivity(actor(E1), { userId: E2 }))).toBe(403);
      expect(await status(analytics.getProductivity(actor(TL), { userId: EB }))).toBe(403);
      expect(await status(analytics.getProductivity(actor(TL), { projectId: 'p-t21-b' }))).toBe(403);
      expect(await status(analytics.getProductivity(actor(E2), { projectId: 'p-t21-a' }))).toBe(403);
      expect(await status(analytics.getProductivity(actor(ADM), { projectId: 'p-missing' }))).toBe(404);
    });

    it('bad ranges are refused', async () => {
      expect(await status(analytics.getProductivity(actor(ADM), { from: '2026-10-06', to: '2026-10-05' }))).toBe(400);
      expect(await status(analytics.getProductivity(actor(ADM), { from: '2026-02-30', to: '2026-03-01' }))).toBe(400);
      expect(await status(analytics.getProductivity(actor(ADM), { from: '2024-01-01', to: '2026-10-05' }))).toBe(400);
    });
  });

  describe('SLA and rework', () => {
    it('SLA is judged on delivery time against the due time, not on hours worked', async () => {
      const sla: any = await analytics.getSlaAnalytics(actor(TL));
      expect(sla.onTimeCount).toBe(1);   // T1
      expect(sla.slaBreaches).toBe(1);   // T2: delivered an hour late with 10 minutes of work
      expect(sla.noDueBasis).toBe(1);    // T5
      expect(sla.averageDelaySeconds).toBe(3600);
    });

    it('rework lists are real counts of rework decisions', async () => {
      const rw: any = await analytics.getReworkAnalytics(actor(ADM));
      expect(rw.mostReworkedEmployees).toEqual([{ userId: E1, name: E1, count: 3 }]);
      expect(rw.mostReworkedTicketTypes).toEqual([{ typeId: 'tt-t21-design', name: 'Design', count: 2 }]);
      const none: any = await analytics.getReworkAnalytics(actor(EB));
      expect(none.mostReworkedEmployees).toEqual([]);
    });

    it('team rankings are reported unavailable, not as an empty result', async () => {
      const m: any = await analytics.getManagerMetrics(actor(ADM));
      expect(m.rankingsAvailable).toBe(false);
      // (1800 + 1800 + 1800 + 600 + 600) / 5 decided reviews
      expect(m.averageTurnaroundTime).toBe(1320);
    });
  });
});
