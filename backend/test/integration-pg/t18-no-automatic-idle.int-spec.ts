/**
 * Phase 6C against real PostgreSQL: with automatic idle detection retired,
 * inactivity alone changes nothing. A punched-in day stays WORKING, and its
 * employee and review clocks keep running, until the person deliberately
 * starts a break, ends the day or punches out.
 *
 * The frontend no longer calls POST /workday/idle (see the unit suite
 * idle-retirement.spec.ts). What is proven here is the backend half: hours
 * pass with nobody calling anything, then every read a page load, refresh,
 * focus or deploy-like reload performs (GET /workday/today, the active timer,
 * the ticket list and detail) and the hourly inactivity scheduler run, and not
 * one row changes. The manual actions keep their existing rules.
 *
 * Real: Prisma, PostgreSQL, WorkdayService, TicketLedgerService,
 * TicketsService, SchedulerService.autoLogoutInactive. Doubled: websocket
 * gateway, notifications, event bus, operational event log, settings, the
 * permission service (a fixed reviewer), the SLA decorator.
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
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { SchedulerService } from '../../src/modules/platform/scheduler/scheduler.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const W = 'u-t18-worker';
const R = 'u-t18-reviewer';
const userObj = (id: string) => ({ id, role: { name: id === W ? 'EMPLOYEE' : 'MANAGER' } });

// 10:30 IST on a Tuesday, inside the scheduler's 09:00-20:00 company window.
const START = Date.parse('2026-10-06T05:00:00.000Z');

describe('T18 no automatic idle: inactivity alone changes nothing (PostgreSQL)', () => {
  let prisma: PrismaService;
  let tva: TVAService;
  let ledger: TicketLedgerService;
  let workday: WorkdayService;
  let tickets: TicketsService;
  let scheduler: SchedulerService;
  let nowMs = 0;
  let seq = 0;

  const quiet = {
    gateway: { emitTicketStatusChanged: jest.fn(), emitTicketCreated: jest.fn(), server: undefined },
    notifications: { sendNotification: jest.fn(async () => null) },
    bus: { emit: jest.fn(() => true) },
    eventLog: { log: jest.fn(async () => undefined) },
  };
  const access = {
    isSelfAssigned: () => false,
    viewerCanApprove: async (user: any, ticket: any) => ticket?.status === 'REVIEW' && user?.id === R,
    viewerCanClose: async () => false,
    findAccessibleTicket: async (id: string, _user: any, include?: any) =>
      prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: include ?? { assignees: true } }),
    buildTicketWhereForUser: async () => ({}),
    assertCanTransitionTicket: async () => undefined,
    assertCanAssignTicket: async () => undefined,
    assertCanUpdateTicket: async () => undefined,
  };

  const advance = (seconds: number) => { nowMs += seconds * 1000; };
  const now = () => new Date(nowMs);
  const active = (userId: string) => prisma.ticketTimeLog.findMany({ where: { userId, endedAt: null } });
  const activeKinds = async (userId: string) => (await active(userId)).map((r) => [r.ownerType, r.ticketId]).sort();
  const sessionOf = (userId: string) => prisma.workSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
  const userStatus = async (userId: string) => (await prisma.user.findUnique({ where: { id: userId } }))!.currentStatus;
  const auditClean = async () => (await runReadOnlyAudit(prisma as any, { now: now(), staleHours: 12, sampleLimit: 5 })).result;

  /** Every row of every table a workday, break or clock lives in. */
  async function snapshot() {
    const out: Record<string, string> = {};
    for (const table of ['work_sessions', 'break_logs', 'ticket_time_logs', 'attendance_events', 'review_cycle_logs', 'tickets', 'users', 'notifications']) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ${table} t`,
      );
      out[table] = `${row.n}:${row.h}`;
    }
    return out;
  }

  async function seed() {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.role.createMany({
      data: [{ id: 'r-t18-manager', name: 'MANAGER', level: 2 }, { id: 'r-t18-employee', name: 'EMPLOYEE', level: 4 }] as any,
    });
    for (const id of [W, R]) {
      await prisma.user.create({
        data: {
          id, roleId: id === W ? 'r-t18-employee' : 'r-t18-manager', name: id,
          email: `${id}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE',
        } as any,
      });
    }
  }

  async function newTicket(assignedToId: string) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        ticketId: `TKT-T18-${seq}`, title: `No-idle fixture ${seq}`, category: 'IT', type: 'TASK',
        createdById: R, assignedToId, estimatedMinutes: 600,
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

  /** W timing their ticket; R reviewing another of W's tickets, R's own work paused by the review. */
  async function workerAndReviewer() {
    const own = await working(R);
    const t = await working(W);
    const r = await newTicket(W);
    advance(60);
    await tickets.update(r.id, { status: TicketStatus.IN_PROGRESS }, W);
    advance(300);
    await tickets.update(r.id, { status: TicketStatus.REVIEW }, W);
    await tickets.startReview(r.id, R, userObj(R));
    return { own, t, r };
  }

  /** Everything a page load, refresh, focus or deploy-like reload reads. */
  async function everyRead(ticketId: string) {
    for (const id of [W, R]) {
      await workday.getToday(id);
      await tickets.getActiveTimer(id);
      await tickets.findAll({ page: 1, limit: 25 }, userObj(id));
      await tickets.findOne(ticketId, userObj(id)).catch(() => undefined);
    }
  }

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    tva = new TVAService({ get: () => undefined } as any);
    ledger = new TicketLedgerService(prisma, tva);
    const authority = new AttendanceAuthorityService(prisma);
    workday = new WorkdayService(
      prisma, {} as any, quiet.eventLog as any, ledger, quiet.notifications as any, authority, tva,
    );
    tickets = new TicketsService(
      prisma, quiet.gateway as any, quiet.notifications as any, { get: () => undefined } as any,
      quiet.bus as any, quiet.eventLog as any, access as any,
      { resolvePrimaryApproverFor: async () => null, resolveTaskCreationApprover: async () => null } as any,
      {
        getSlaConfig: async () => ({ review: { LOW: 48, MEDIUM: 24, HIGH: 8, URGENT: 4 } }),
        decorateTicket: async (t: any) => t,
        decorateTickets: async (ts: any[]) => ts,
      } as any,
      ledger, {} as any, new ActiveWorkdayPolicyService(tva), tva,
    );
    scheduler = new SchedulerService(
      prisma, quiet.gateway as any, ledger, quiet.notifications as any, { get: () => undefined } as any,
      tva, authority, workday,
    );
  });

  beforeEach(async () => {
    jest.spyOn(tva, 'now').mockImplementation(() => new Date(nowMs));
    nowMs = START;
    await seed();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  it('1. three hours with nobody calling anything: the day stays WORKING and both clocks keep running', async () => {
    const { t, r } = await workerAndReviewer();
    const before = await snapshot();
    const kindsW = await activeKinds(W);
    const kindsR = await activeKinds(R);
    expect(kindsW).toEqual([['ASSIGNEE', t.id]]);
    expect(kindsR).toEqual([['REVIEWER', r.id]]);

    advance(3 * 3600);
    expect(await snapshot()).toEqual(before);
    for (const id of [W, R]) {
      expect((await sessionOf(id))!.status).toBe('WORKING');
      expect(await userStatus(id)).toBe('WORKING');
    }
    // The running rows are open: their time keeps counting up to now.
    expect(await activeKinds(W)).toEqual(kindsW);
    expect(await activeKinds(R)).toEqual(kindsR);
    expect(await prisma.attendanceEvent.count({ where: { eventType: 'IDLE_DETECTED' } })).toBe(0);
  });

  it('2. page load, refresh, focus and deploy-like reloads only read: not one row changes', async () => {
    const { t } = await workerAndReviewer();
    advance(2 * 3600);
    const before = await snapshot();
    for (let reload = 0; reload < 3; reload++) {
      await everyRead(t.id);
      advance(30);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('3. the hourly inactivity scheduler never touches a WORKING day, however long nobody acts', async () => {
    await workerAndReviewer();
    for (let hour = 0; hour < 6; hour++) {
      advance(3600);
      const before = await snapshot();
      await scheduler.autoLogoutInactive();
      expect(await snapshot()).toEqual(before);
    }
    expect((await sessionOf(W))!.status).toBe('WORKING');
    expect((await sessionOf(R))!.status).toBe('WORKING');
  });

  it('4. Start Break still pauses the employee and review clocks; End Break resumes employee work only', async () => {
    const { own, t } = await workerAndReviewer();
    advance(600);
    await workday.startBreak(W, { breakType: 'TEA' });
    await workday.startBreak(R, { breakType: 'TEA' });
    expect(await active(W)).toHaveLength(0);
    expect(await active(R)).toHaveLength(0);
    expect((await sessionOf(W))!.status).toBe('ON_BREAK');

    advance(900);
    await workday.endBreak(W);
    await workday.endBreak(R);
    expect(await activeKinds(W)).toEqual([['ASSIGNEE', t.id]]);
    expect(await activeKinds(R)).toEqual([['ASSIGNEE', own.id]]); // never the review
    expect((await sessionOf(W))!.status).toBe('WORKING');
    expect(await auditClean()).toBe('CLEAN');
  });

  it('5. End Day still pauses every clock and closes the day; reads afterwards change nothing', async () => {
    const { t } = await workerAndReviewer();
    advance(1800);
    await workday.endWork(W);
    await workday.endWork(R);
    expect(await active(W)).toHaveLength(0);
    expect(await active(R)).toHaveLength(0);
    expect((await sessionOf(W))!.status).toBe('LOGGED_OUT');
    const before = await snapshot();
    advance(3600);
    await everyRead(t.id);
    expect(await snapshot()).toEqual(before);
    expect(await auditClean()).toBe('CLEAN');
  });

  it('6. Start Work keeps its resume rule: the paused employee ticket resumes, a review never does', async () => {
    const { own } = await workerAndReviewer();
    advance(600);
    await workday.endWork(R);
    advance(600);
    await workday.startWork(R);
    expect(await activeKinds(R)).toEqual([['ASSIGNEE', own.id]]);
    expect(await auditClean()).toBe('CLEAN');
  });

  it('7. an IDLE day from before the retirement is left exactly as it is by reads and the passing of time', async () => {
    const t = await working(W);
    advance(25 * 60);
    await workday.reportIdle(W, 20); // the retired frontend path, only to build a legacy IDLE day
    expect((await sessionOf(W))!.status).toBe('IDLE');
    const before = await snapshot();
    advance(30 * 60);
    await everyRead(t.id);
    expect(await snapshot()).toEqual(before);
    expect(await active(W)).toHaveLength(0); // nothing auto-resumes

    // The manual way on: a break, whose end resumes the paused ticket.
    await workday.startBreak(W, { breakType: 'TEA' });
    advance(60);
    await workday.endBreak(W);
    expect(await activeKinds(W)).toEqual([['ASSIGNEE', t.id]]);
    expect((await sessionOf(W))!.status).toBe('WORKING');
    expect(await auditClean()).toBe('CLEAN');
  });
});
