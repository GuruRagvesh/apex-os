/**
 * Phase 5A against real PostgreSQL: the idle workflow's backend transitions.
 *
 * Real: Prisma, PostgreSQL, row and advisory locks, the one-active-timed
 * index, WorkdayService (reportIdle / resumeWork / startBreak / endBreak /
 * endWork / startWork), TicketLedgerService, TicketsService (update /
 * startReview / pauseReview). Doubled: websocket gateway, notifications, event
 * bus, operational event log, the permission service (a fixed reviewer).
 *
 * One mutable TVA clock drives every service, so back-dated pauses are exact.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ActiveWorkdayPolicyService } from '../../src/common/services/active-workday-policy.service';
import { AttendanceAuthorityService } from '../../src/common/services/attendance-authority.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { BREAK_FROM_IDLE_SOURCE, WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const W = 'u-t14-worker';
const R = 'u-t14-reviewer';
const userObj = (id: string) => ({ id, role: { name: id === W ? 'EMPLOYEE' : 'MANAGER' } });

describe('T14 idle runtime (PostgreSQL)', () => {
  let prisma: PrismaService;
  let tva: TVAService;
  let ledger: TicketLedgerService;
  let workday: WorkdayService;
  let tickets: TicketsService;
  let nowMs = 0;
  let seq = 0;

  const quiet = {
    gateway: { emitTicketStatusChanged: jest.fn(), emitTicketCreated: jest.fn() },
    notifications: { sendNotification: jest.fn(async () => null) },
    bus: { emit: jest.fn(() => true) },
    eventLog: { log: jest.fn(async () => undefined) },
  };
  const access = {
    isSelfAssigned: () => false,
    viewerCanApprove: async (user: any, ticket: any) => ticket?.status === 'REVIEW' && user?.id === R,
    findAccessibleTicket: async (id: string, _user: any, include?: any) =>
      prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: include ?? { assignees: true } }),
    assertCanTransitionTicket: async () => undefined,
    assertCanAssignTicket: async () => undefined,
    assertCanUpdateTicket: async () => undefined,
  };

  const advance = (seconds: number) => { nowMs += seconds * 1000; };
  const now = () => new Date(nowMs);
  const active = (userId: string) => prisma.ticketTimeLog.findMany({ where: { userId, endedAt: null } });
  const rowsOf = (userId: string) => prisma.ticketTimeLog.findMany({ where: { userId }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] });
  const sessionOf = (userId: string) => prisma.workSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
  const userStatus = async (userId: string) => (await prisma.user.findUnique({ where: { id: userId } }))!.currentStatus;
  const idleEvents = (userId: string) => prisma.attendanceEvent.findMany({ where: { userId, eventType: 'IDLE_DETECTED' }, orderBy: { timestamp: 'asc' } });
  const auditClean = async () => (await runReadOnlyAudit(prisma as any, { now: now(), staleHours: 12, sampleLimit: 5 })).result;

  async function stateSnapshot(userId: string) {
    return {
      session: (await sessionOf(userId))?.status,
      user: await userStatus(userId),
      rows: (await rowsOf(userId)).map((r) => [r.ticketId, r.ownerType, r.endedAt?.getTime() ?? null, r.pauseReason]),
      breaks: await prisma.breakLog.count({ where: { userId } }),
    };
  }

  async function seed() {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.role.createMany({
      data: [{ id: 'r-t14-manager', name: 'MANAGER', level: 2 }, { id: 'r-t14-employee', name: 'EMPLOYEE', level: 4 }] as any,
    });
    for (const id of [W, R]) {
      await prisma.user.create({
        data: {
          id, roleId: id === W ? 'r-t14-employee' : 'r-t14-manager', name: id,
          email: `${id}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE',
        } as any,
      });
    }
  }

  async function newTicket(assignedToId: string) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        ticketId: `TKT-T14-${seq}`, title: `Idle fixture ${seq}`, category: 'IT', type: 'TASK',
        createdById: R, assignedToId, estimatedMinutes: 120,
      } as any,
    });
  }

  /** `userId` WORKING, timing a ticket of their own. */
  async function working(userId: string) {
    await workday.startWork(userId);
    const t = await newTicket(userId);
    await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, userId);
    return t;
  }

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    tva = new TVAService({ get: () => undefined } as any);
    ledger = new TicketLedgerService(prisma, tva);
    workday = new WorkdayService(
      prisma, {} as any, quiet.eventLog as any, ledger, quiet.notifications as any,
      new AttendanceAuthorityService(prisma), tva,
    );
    tickets = new TicketsService(
      prisma, quiet.gateway as any, quiet.notifications as any, { get: () => undefined } as any,
      quiet.bus as any, quiet.eventLog as any, access as any,
      { resolvePrimaryApproverFor: async () => null, resolveTaskCreationApprover: async () => null } as any,
      { getSlaConfig: async () => ({ review: { LOW: 48, MEDIUM: 24, HIGH: 8, URGENT: 4 } }), decorateTicket: async (t: any) => t } as any,
      ledger, {} as any, new ActiveWorkdayPolicyService(tva), tva,
    );
  });

  beforeEach(async () => {
    jest.spyOn(tva, 'now').mockImplementation(() => new Date(nowMs));
    nowMs = Math.floor(Date.now() / 1000) * 1000;
    await seed();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  it('1. idle pauses the employee timer back-dated to when inactivity began; one report changes state once', async () => {
    const t = await working(W);
    advance(30 * 60);
    await expect(workday.reportIdle(W, 25)).resolves.toEqual({ status: 'ok', applied: true });
    const [row] = await rowsOf(W);
    expect(row).toMatchObject({ ticketId: t.id, pauseReason: 'IDLE' });
    expect(row.endedAt!.getTime()).toBe(nowMs - 25 * 60_000);
    expect(row.durationSeconds).toBe(5 * 60);
    expect(await active(W)).toHaveLength(0);
    expect((await sessionOf(W))!.status).toBe('IDLE');
    expect(await userStatus(W)).toBe('IDLE');

    // A second report of the same episode (another tab) changes nothing.
    const before = await stateSnapshot(W);
    advance(60);
    await expect(workday.reportIdle(W, 26)).resolves.toEqual({ status: 'ok', applied: false });
    expect(await stateSnapshot(W)).toEqual(before);
    expect((await idleEvents(W)).map((e) => (e.metadata as any).applied)).toEqual([true, false]);
    expect(await auditClean()).toBe('CLEAN');
  });

  it('2. no idle while not WORKING: on break, after End Day, or never started — state untouched', async () => {
    await working(W);
    await workday.startBreak(W, { breakType: 'TEA' });
    let before = await stateSnapshot(W);
    await expect(workday.reportIdle(W, 30)).resolves.toMatchObject({ applied: false });
    expect(await stateSnapshot(W)).toEqual(before);
    expect(await userStatus(W)).toBe('ON_BREAK'); // a stale tab never stamps IDLE over a break

    await workday.endBreak(W);
    await workday.endWork(W);
    before = await stateSnapshot(W);
    await expect(workday.reportIdle(W, 30)).resolves.toMatchObject({ applied: false });
    expect(await stateSnapshot(W)).toEqual(before);
    expect(await userStatus(W)).toBe('LOGGED_OUT');

    await expect(workday.reportIdle(R, 30)).resolves.toMatchObject({ applied: false }); // never started
    expect(await userStatus(R)).toBe('OFFLINE');
  });

  it('3. an invalid duration is refused and writes nothing', async () => {
    await working(W);
    const before = await stateSnapshot(W);
    for (const bad of [-5, 2000, Number.NaN]) {
      await expect(workday.reportIdle(W, bad)).rejects.toThrow('idleDuration must be a number of minutes between 0 and 1440.');
    }
    expect(await stateSnapshot(W)).toEqual(before);
    expect(await idleEvents(W)).toHaveLength(0);
  });

  it('4. Resume Work restarts the exact idle-paused employee ticket', async () => {
    const t = await working(W);
    advance(25 * 60);
    await workday.reportIdle(W, 21);
    advance(5 * 60);
    await workday.resumeWork(W);
    const running = await active(W);
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ ticketId: t.id, ownerType: 'ASSIGNEE', startedAt: now() });
    expect(await userStatus(W)).toBe('WORKING');
    expect(await auditClean()).toBe('CLEAN');
  });

  it('5. a reviewer idles mid-review: the review pauses (back-dated) and never resumes; their employee work does', async () => {
    const own = await working(R);
    await workday.startWork(W);
    const r = await newTicket(W);
    await tickets.update(r.id, { status: TicketStatus.IN_PROGRESS }, W);
    advance(300);
    await tickets.update(r.id, { status: TicketStatus.REVIEW }, W);
    await tickets.startReview(r.id, R, userObj(R));             // pauses R's own ticket (REVIEW_SWITCHED)
    advance(30 * 60);
    await workday.reportIdle(R, 20);
    const review = (await rowsOf(R)).find((x) => x.ownerType === 'REVIEWER')!;
    expect(review).toMatchObject({ pauseReason: 'IDLE', durationSeconds: 10 * 60 });
    expect(await active(R)).toHaveLength(0);

    advance(60);
    await workday.resumeWork(R);
    const running = await active(R);
    expect(running.map((x) => x.ownerType)).toEqual(['ASSIGNEE']); // never the review
    expect(running[0].ticketId).toBe(own.id);
    expect(await prisma.ticketTimeLog.count({ where: { userId: R, ownerType: 'REVIEWER', endedAt: null } })).toBe(0);
    expect(await auditClean()).toBe('CLEAN');
  });

  it('6. Take a Break from idle: allowed, pauses nothing more, and ending it resumes the idle-paused ticket exactly', async () => {
    const t = await working(W);
    advance(22 * 60);
    await workday.reportIdle(W, 20);
    const pausedRows = (await rowsOf(W)).length;
    await workday.startBreak(W, { breakType: 'TEA' });
    expect((await sessionOf(W))!.status).toBe('ON_BREAK');
    expect(await userStatus(W)).toBe('ON_BREAK');
    expect((await prisma.breakLog.findFirst({ where: { userId: W } }))!.source).toBe(BREAK_FROM_IDLE_SOURCE);
    expect((await rowsOf(W)).length).toBe(pausedRows); // nothing new paused or started

    advance(10 * 60);
    await workday.endBreak(W);
    const running = await active(W);
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ ticketId: t.id, ownerType: 'ASSIGNEE', startedAt: now() });
    expect(await auditClean()).toBe('CLEAN');
  });

  it('7. End Workday from idle closes the day; a stale tab\'s Resume afterwards writes nothing and never marks it WORKING', async () => {
    await working(W);
    advance(21 * 60);
    await workday.reportIdle(W, 20);
    await workday.endWork(W);
    expect((await sessionOf(W))!.status).toBe('LOGGED_OUT');
    const before = await stateSnapshot(W);
    await expect(workday.resumeWork(W)).resolves.toEqual({ message: 'Resumed', updated: 0 });
    expect(await stateSnapshot(W)).toEqual(before);
    expect(await userStatus(W)).toBe('LOGGED_OUT');
    expect(await prisma.attendanceEvent.count({ where: { userId: W, eventType: 'RESUME_WORK' } })).toBe(0);
  });

  it('8. idle racing Start Review: whichever commits first, at most one active timed row and a consistent state', async () => {
    for (let round = 0; round < 3; round += 1) {
      await seed();
      await working(R);
      await workday.startWork(W);
      const r = await newTicket(W);
      await tickets.update(r.id, { status: TicketStatus.IN_PROGRESS }, W);
      await tickets.update(r.id, { status: TicketStatus.REVIEW }, W);
      advance(25 * 60);
      const results = await Promise.allSettled([
        workday.reportIdle(R, 20),
        tickets.startReview(r.id, R, userObj(R)),
      ]);
      expect(results[0].status).toBe('fulfilled');
      // Either order ends the same way: idle first refuses the review start
      // (the reviewer is not WORKING); review first is then paused by idle.
      expect(await active(R)).toHaveLength(0);
      expect((await sessionOf(R))!.status).toBe('IDLE');
      if (results[1].status === 'rejected') {
        expect((results[1].reason as any).getResponse()).toMatchObject({ code: 'REVIEWER_NOT_WORKING' });
      } else {
        expect((await rowsOf(R)).find((x) => x.ownerType === 'REVIEWER')).toMatchObject({ pauseReason: 'IDLE' });
      }
      expect(await auditClean()).toBe('CLEAN');
    }
  });

  it('9. idle racing a ticket transition (submit to review): consistent, no orphan timer', async () => {
    for (let round = 0; round < 3; round += 1) {
      await seed();
      const t = await working(W);
      advance(25 * 60);
      const results = await Promise.allSettled([
        workday.reportIdle(W, 20),
        tickets.update(t.id, { status: TicketStatus.REVIEW }, W),
      ]);
      expect(results[0].status).toBe('fulfilled');
      expect(await active(W)).toHaveLength(0);
      const ticket = await prisma.ticket.findUnique({ where: { id: t.id } });
      if (results[1].status === 'fulfilled') expect(ticket!.status).toBe('REVIEW');
      expect(await auditClean()).toBe('CLEAN');
    }
  });

  it('10. explicitly started work on a weekend: idle and resume behave exactly as on a working day', async () => {
    // A Sunday, 10:00 IST.
    nowMs = Date.parse('2026-10-04T04:30:00.000Z');
    const t = await working(W);
    advance(30 * 60);
    await expect(workday.reportIdle(W, 20)).resolves.toMatchObject({ applied: true });
    advance(60);
    await workday.resumeWork(W);
    expect((await active(W)).map((x) => x.ticketId)).toEqual([t.id]);
    expect(await userStatus(W)).toBe('WORKING');
  });
});
