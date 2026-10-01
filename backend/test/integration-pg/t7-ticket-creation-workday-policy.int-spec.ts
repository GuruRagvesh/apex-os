/**
 * Phase 3 against real PostgreSQL: human ticket creation requires an active
 * workday, creation never starts a timer, starting work needs a primary owner,
 * and a rework cycle is timed against its own estimate on the TVA clock.
 *
 * Real: Prisma, PostgreSQL, row locks, TicketsService (create / createBulk /
 * update / reject), ActiveWorkdayPolicyService, TicketLedgerService,
 * WorkdayService, PunchEvidenceService (Punch In / Punch Out) and
 * SchedulerService (policy auto-stop). Doubled: websocket gateway,
 * notifications, event bus, operational event log (all recorded),
 * permissions, the SLA decorator, the attendance feature flag and the daily
 * attendance context.
 *
 * Races are coordinated, never timed: one side is parked at a known point
 * inside its transaction, and the other is observed waiting on a PostgreSQL
 * lock (pg_locks) before the first is released.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TVAService } from '../../src/common/services/tva.service';
import {
  ACTIVE_WORKDAY_REQUIRED,
  ACTIVE_WORKDAY_REQUIRED_MESSAGE,
  ActiveWorkdayPolicyService,
} from '../../src/common/services/active-workday-policy.service';
import { AttendanceAuthorityService } from '../../src/common/services/attendance-authority.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { PRIMARY_ASSIGNEE_REQUIRED, TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { SchedulerService } from '../../src/modules/platform/scheduler/scheduler.service';
import { PunchEvidenceService } from '../../src/modules/platform/attendance/punch/punch-evidence.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { oneActiveIndexState } from './one-active-index';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const DEPT = 'd-t7-ops';
const W = 'u-t7-employee';
const M = 'u-t7-manager';
const ROLE_USERS: Array<[string, string]> = [
  ['SUPER_ADMIN', 'u-t7-super-admin'],
  ['ADMIN', 'u-t7-admin'],
  ['MANAGER', M],
  ['TEAM_LEAD', 'u-t7-team-lead'],
  ['EMPLOYEE', W],
  ['INTERN', 'u-t7-intern'],
];
const roleOf = (userId: string) => ROLE_USERS.find(([, id]) => id === userId)![0];
const actor = (userId: string) => ({ id: userId, role: { name: roleOf(userId) } });

describe('T7 ticket creation requires an active workday (PostgreSQL)', () => {
  let prisma: PrismaService;
  let tva: TVAService;
  let ledger: TicketLedgerService;
  let workday: WorkdayService;
  let tickets: TicketsService;
  let seq = 0;

  const effects = {
    gateway: { emitTicketStatusChanged: jest.fn(), emitTicketCreated: jest.fn() },
    notifications: { sendNotification: jest.fn(async () => null) },
    bus: { emit: jest.fn(() => true) },
    eventLog: { log: jest.fn(async () => undefined) },
  };
  const resetEffects = () => Object.values(effects).forEach((o) => Object.values(o).forEach((f) => (f as jest.Mock).mockClear()));
  const expectNothingAnnounced = () => {
    expect(effects.gateway.emitTicketCreated).not.toHaveBeenCalled();
    expect(effects.gateway.emitTicketStatusChanged).not.toHaveBeenCalled();
    expect(effects.notifications.sendNotification).not.toHaveBeenCalled();
    expect(effects.bus.emit).not.toHaveBeenCalled();
    expect(effects.eventLog.log).not.toHaveBeenCalled();
  };

  function makeTickets(clock: TVAService, timerLedger: TicketLedgerService = ledger) {
    return new TicketsService(
      prisma,
      effects.gateway as any,
      effects.notifications as any,
      { get: () => undefined } as any,
      effects.bus as any,
      effects.eventLog as any,
      { isSelfAssigned: () => false, assertCanCreateInDepartment: async () => undefined } as any,
      { resolvePrimaryApproverFor: async () => null, resolveTaskCreationApprover: async () => null } as any,
      { getSlaConfig: async () => ({ review: { MEDIUM: 24 } }), decorateTicket: async (t: any) => t } as any,
      timerLedger,
      {} as any,
      new ActiveWorkdayPolicyService(clock),
      clock,
    );
  }

  /** A TVA clock fixed at `at`. */
  function clockAt(at: Date) {
    const clock = new TVAService({ get: () => undefined } as any);
    jest.spyOn(clock, 'now').mockReturnValue(at);
    return clock;
  }

  // ── Transaction coordination (same technique as t6) ──────────────────────

  /** Wraps the NEXT transaction the code opens, with a hook on one tx member. */
  function interceptNextTransaction(
    member: string,
    op: string | null,
    hook: (call: number, run: () => Promise<any>) => Promise<any>,
  ) {
    const original = prisma.$transaction.bind(prisma);
    let calls = 0;
    jest.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: any, txOpts: any) =>
      original((tx: any) => fn(new Proxy(tx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (prop !== member) return typeof value === 'function' ? value.bind(target) : value;
          if (op === null) {
            // A tx method itself, e.g. $queryRaw.
            return (...args: any[]) => {
              calls += 1;
              return hook(calls, () => value.apply(target, args));
            };
          }
          return new Proxy(value, {
            get(delegate, method) {
              const fnValue = Reflect.get(delegate, method, delegate);
              if (method !== op) return typeof fnValue === 'function' ? fnValue.bind(delegate) : fnValue;
              return (...args: any[]) => {
                calls += 1;
                return hook(calls, () => fnValue.apply(delegate, args));
              };
            },
          });
        },
      })), txOpts)) as any);
  }

  /** Parks the next transaction right after the `nth` call of member(.op) returns. */
  function pauseNextTransactionAfter(member: string, op: string | null, nth: number) {
    let reached!: () => void;
    let release!: () => void;
    const reachedP = new Promise<void>((r) => (reached = r));
    const gate = new Promise<void>((r) => (release = r));
    interceptNextTransaction(member, op, async (call, run) => {
      const result = await run();
      if (call === nth) {
        reached();
        await gate;
      }
      return result;
    });
    return { reached: reachedP, release };
  }

  /**
   * Holds the NEXT transaction before it opens: the caller has finished its
   * pre-transaction reads, and has taken no lock yet.
   */
  function holdNextTransactionStart() {
    let reached!: () => void;
    let release!: () => void;
    const reachedP = new Promise<void>((r) => (reached = r));
    const gate = new Promise<void>((r) => (release = r));
    const original = prisma.$transaction.bind(prisma);
    jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (fn: any, txOpts: any) => {
      reached();
      await gate;
      return original(fn, txOpts);
    }) as any);
    return { reached: reachedP, release };
  }

  function failNextTransactionOn(model: string, op: string) {
    interceptNextTransaction(model, op, async () => {
      throw new Error(`forced ${model}.${op} failure`);
    });
  }

  /** Observable condition, not a sleep: some backend is waiting for a lock. */
  async function waitUntilSomeoneWaitsForALock(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`);
      if (row.n > 0) return;
      if (Date.now() > deadline) throw new Error('no transaction became blocked on a lock');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function parked<T>(pause: { reached: Promise<void> }, work: Promise<T>) {
    await Promise.race([pause.reached, work.then(() => { throw new Error('finished without reaching the pause point'); })]);
  }

  // ── Fixtures ──────────────────────────────────────────────────────────────

  const count = (table: string, where = 'TRUE') =>
    prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`).then((r) => r[0].n as number);
  const ticketRow = (id: string) => prisma.ticket.findUnique({ where: { id } });
  const activeFor = (userId: string) => prisma.ticketTimeLog.findMany({ where: { userId, ownerType: 'ASSIGNEE', endedAt: null } });
  const latestSession = (userId: string) => prisma.workSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
  const auditClean = async (now = new Date()) =>
    (await runReadOnlyAudit(prisma as any, { now, staleHours: 12, sampleLimit: 5 })).result;

  /** Fingerprint of everything creation can write. */
  async function snapshot() {
    const out: Record<string, string> = {};
    for (const table of ['tickets', 'ticket_assignees', 'activity_logs', 'ticket_time_logs', 'work_sessions']) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ${table} t`,
      );
      out[table] = `${row.n}:${row.h}`;
    }
    return out;
  }

  async function seedUsers() {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.department.upsert({ where: { id: DEPT }, create: { id: DEPT, name: 'T7 Operations' }, update: {} });
    for (const [name] of ROLE_USERS) {
      await prisma.role.create({ data: { id: `r-t7-${name.toLowerCase()}`, name, level: 3 } as any });
    }
    for (const [name, id] of ROLE_USERS) {
      await prisma.user.create({
        data: {
          id, roleId: `r-t7-${name.toLowerCase()}`, departmentId: DEPT, name: id,
          email: `${id}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE',
        } as any,
      });
    }
  }

  /** A request body as the create form sends it. */
  function body(fields: Record<string, any> = {}) {
    seq += 1;
    return {
      title: `T7 ticket ${seq}`,
      type: 'TASK',
      category: 'IT',
      priority: 'MEDIUM',
      departmentId: DEPT,
      assignedToId: W,
      assigneeIds: [W],
      ...fields,
    };
  }

  /** A fixture ticket written directly (not through the gated create path). */
  async function fixtureTicket(fields: Record<string, any> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        ticketId: `TKT-T7-${seq}`, title: `T7 fixture ${seq}`, category: 'IT', type: 'TASK',
        createdById: M, assignedToId: W, estimatedMinutes: 120, ...fields,
      } as any,
    });
  }

  /** A work session on the current company date, written directly. */
  async function sessionToday(userId: string, status: string, extra: Record<string, any> = {}) {
    const now = new Date();
    return prisma.workSession.create({
      data: {
        userId, date: tva.companyDateOnly(), status,
        ...(status === 'LOGGED_IN' || status === 'ON_LEAVE' ? {} : { loginAt: now, startWorkAt: now }),
        ...extra,
      } as any,
    });
  }

  async function expectRefused(act: () => Promise<unknown>) {
    const before = await snapshot();
    resetEffects();
    const err = await act().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getStatus()).toBe(409);
    expect((err as ConflictException).getResponse()).toEqual({
      statusCode: 409,
      code: ACTIVE_WORKDAY_REQUIRED,
      message: ACTIVE_WORKDAY_REQUIRED_MESSAGE,
    });
    expect(await snapshot()).toEqual(before);
    expectNothingAnnounced();
  }

  /** Creation succeeded: one OPEN ticket, its records, no timer, announced once after commit. */
  async function expectCreatedWithoutTimer(created: any, creatorId: string) {
    const row = await ticketRow(created.id);
    expect(row).toMatchObject({ status: 'OPEN', createdById: creatorId, actualStartAt: null });
    expect(await count('ticket_time_logs', `"ticketId" = '${created.id}'`)).toBe(0);
    expect(await count('activity_logs', `"entityId" = '${created.id}' AND action = 'TICKET_CREATED'`)).toBe(1);
    expect(effects.gateway.emitTicketCreated).toHaveBeenCalledTimes(1);
    expect(effects.bus.emit).toHaveBeenCalledWith('ticket.created', expect.anything());
  }

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    tva = new TVAService({ get: () => undefined } as any);
    ledger = new TicketLedgerService(prisma, tva);
    workday = new WorkdayService(
      prisma, {} as any, effects.eventLog as any, ledger, effects.notifications as any,
      new AttendanceAuthorityService(prisma), tva,
    );
    tickets = makeTickets(tva);
    expect((await oneActiveIndexState(prisma)).valid).toBe(true);
  });

  beforeEach(async () => {
    await seedUsers();
    resetEffects();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    // No fixtures survive: a post-run integrity audit must read CLEAN.
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma?.department.deleteMany({ where: { id: DEPT } });
    await prisma?.$disconnect();
  });

  // ── 1. Eligibility ────────────────────────────────────────────────────────

  describe('eligibility, for every role', () => {
    it.each(ROLE_USERS)('%s with no work session today is refused with 409 ACTIVE_WORKDAY_REQUIRED', async (_role, userId) => {
      await expectRefused(() => tickets.create(body(), userId, actor(userId)));
    });

    it.each(ROLE_USERS)('%s who has started work creates an OPEN ticket with no timer', async (_role, userId) => {
      await workday.startWork(userId);
      resetEffects();
      const created = await tickets.create(body(), userId, actor(userId));
      await expectCreatedWithoutTimer(created, userId);
    });
  });

  describe('eligibility, for every work-session state', () => {
    const create = () => tickets.create(body(), W, actor(W));

    it('WORKING: allowed, with no productive time and a CLEAN timer audit', async () => {
      await workday.startWork(W);
      resetEffects();
      const created = await create();
      await expectCreatedWithoutTimer(created, W);
      const ticket = await tickets.findOne(created.id);
      expect(ticket.timers).toMatchObject({ activeClock: 'NONE', employeeWorkSeconds: 0 });
      expect(await auditClean()).toBe('CLEAN');
    });

    it('currentStatus WORKING without a session: refused (the session ledger decides, not currentStatus)', async () => {
      await prisma.user.update({ where: { id: W }, data: { currentStatus: 'WORKING' } });
      await expectRefused(create);
    });

    it('a valid session with a stale currentStatus (OFFLINE): allowed, the session decides', async () => {
      await sessionToday(W, 'WORKING');
      expect((await prisma.user.findUnique({ where: { id: W } }))!.currentStatus).toBe('OFFLINE');
      await expectCreatedWithoutTimer(await create(), W);
    });

    it('a superseded session: an older row left open behind a newer closed one is refused', async () => {
      const now = Date.now();
      await sessionToday(W, 'WORKING', { createdAt: new Date(now - 60 * 60_000) });
      await sessionToday(W, 'LOGGED_OUT', { createdAt: new Date(now - 60_000), logoutAt: new Date(now - 60_000) });
      await expectRefused(create);
    });

    it('ON_BREAK: allowed (a break is inside the workday)', async () => {
      await workday.startWork(W);
      await workday.startBreak(W, { breakType: 'TEA' });
      resetEffects();
      await expectCreatedWithoutTimer(await create(), W);
    });

    it('IDLE: allowed (an idle pause is inside the workday)', async () => {
      await sessionToday(W, 'IDLE');
      await expectCreatedWithoutTimer(await create(), W);
    });

    it('no session today: refused', async () => {
      await expectRefused(create);
    });

    it('LOGGED_IN session that never started work: refused', async () => {
      await sessionToday(W, 'LOGGED_IN');
      await expectRefused(create);
    });

    it('ON_LEAVE: refused', async () => {
      await sessionToday(W, 'ON_LEAVE');
      await expectRefused(create);
    });

    it('after End Day (LOGGED_OUT): refused', async () => {
      await workday.startWork(W);
      await workday.endWork(W);
      expect(await latestSession(W)).toMatchObject({ status: 'LOGGED_OUT' });
      await expectRefused(create);
    });

    it('AUTO_CLOSED: refused', async () => {
      await sessionToday(W, 'AUTO_CLOSED', { logoutAt: new Date(), autoClosed: true });
      await expectRefused(create);
    });

    it('a WORKING row that already has logoutAt: refused (logoutAt closes a session whatever its status says)', async () => {
      await sessionToday(W, 'WORKING', { logoutAt: new Date() });
      await expectRefused(create);
    });

    it('yesterday\'s session still open: refused (only the current company date counts)', async () => {
      const yesterday = new Date(tva.companyDateOnly().getTime() - 24 * 3600_000);
      await prisma.workSession.create({
        data: { userId: W, date: yesterday, status: 'WORKING', loginAt: yesterday, startWorkAt: yesterday } as any,
      });
      await expectRefused(create);
    });

    it('closed earlier today, then started again: allowed (the newest open session counts)', async () => {
      await workday.startWork(W);
      await workday.endWork(W);
      await workday.startWork(W);
      resetEffects();
      await expectCreatedWithoutTimer(await create(), W);
    });
  });

  describe('Punch In and Punch Out through the real punch service', () => {
    function punchService() {
      return new PunchEvidenceService(
        prisma,
        tva,
        { get: async () => ({ punchEvidenceEnabled: true }) } as any,
        { log: async () => undefined } as any,
        {
          resolveDailyContext: async () => ({
            attendanceApplicability: 'REQUIRED',
            blockingReasons: [],
            resolverVersion: 1,
            attendancePolicy: { geoFenceEnabled: false },
            sources: {
              employeeProfileId: null, shiftPolicyId: null, shiftPolicyVersion: null,
              attendancePolicyId: null, attendancePolicyVersion: null, assignedAttendanceLocationId: null,
            },
          }),
        } as any,
        workday,
      );
    }

    let punchNo = 0;
    async function punch(type: 'PUNCH_IN' | 'PUNCH_OUT', userId = W) {
      punchNo += 1;
      const photo = await prisma.attendancePunchPhoto.create({
        data: {
          userId, objectKey: `test:t7:${punchNo}`, sha256: `t7-${punchNo}`, mimeType: 'image/jpeg', byteSize: 1,
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      });
      return punchService().submit(userId, {
        type, idempotencyKey: `t7-${type}-${punchNo}`, latitude: 18.52, longitude: 73.85, accuracyMeters: 10,
        photoAssetId: photo.id,
      } as any);
    }

    it('refused before Punch In, allowed after it, refused again after Punch Out', async () => {
      await expectRefused(() => tickets.create(body(), W, actor(W)));
      await punch('PUNCH_IN');
      resetEffects();
      await expectCreatedWithoutTimer(await tickets.create(body(), W, actor(W)), W);
      await punch('PUNCH_OUT');
      expect(await latestSession(W)).toMatchObject({ status: 'LOGGED_OUT' });
      await expectRefused(() => tickets.create(body(), W, actor(W)));
    });

    it('creation holds the session: a concurrent Punch Out waits, the ticket commits, then the day closes', async () => {
      await punch('PUNCH_IN');
      resetEffects();
      // Parked right after the policy query took the share lock on the session.
      const pause = pauseNextTransactionAfter('$queryRaw', null, 1);
      const creating = tickets.create(body(), W, actor(W));
      await parked(pause, creating);

      const punchingOut = punch('PUNCH_OUT');
      await waitUntilSomeoneWaitsForALock(); // Punch Out is queued behind the creation
      expect(await latestSession(W)).toMatchObject({ status: 'WORKING', logoutAt: null });

      pause.release();
      const created = await creating;
      await punchingOut;
      await expectCreatedWithoutTimer(created, W);
      expect(await latestSession(W)).toMatchObject({ status: 'LOGGED_OUT' });
      expect(await activeFor(W)).toHaveLength(0);
      expect(await auditClean()).toBe('CLEAN');
    });

    it('Punch Out holds the session: a concurrent creation waits, then is refused and writes nothing', async () => {
      await punch('PUNCH_IN');
      const before = await snapshot();
      // Parked right after the finalizer locked and re-read the session.
      const pause = pauseNextTransactionAfter('workSession', 'findUnique', 1);
      const punchingOut = punch('PUNCH_OUT');
      await parked(pause, punchingOut);

      resetEffects();
      const creating = tickets.create(body(), W, actor(W)).then(() => null, (e) => e);
      await waitUntilSomeoneWaitsForALock(); // the creation is queued behind Punch Out

      pause.release();
      await punchingOut;
      const err = await creating;
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: ACTIVE_WORKDAY_REQUIRED });
      expect(await count('tickets')).toBe(0);
      const after = await snapshot();
      expect(after.tickets).toBe(before.tickets);
      expect(after.ticket_assignees).toBe(before.ticket_assignees);
      expect(effects.gateway.emitTicketCreated).not.toHaveBeenCalled();
      expect(await latestSession(W)).toMatchObject({ status: 'LOGGED_OUT' });
    });
  });

  describe('racing the scheduler auto-close', () => {
    // 2026-08-13 14:00Z = 19:30 IST. Policy cutoff 19:00 IST = 13:30Z.
    const NOW = new Date('2026-08-13T14:00:00.000Z');

    function makeScheduler(clock: TVAService) {
      return new SchedulerService(
        prisma, {} as any, ledger, effects.notifications as any,
        { getWorkdayPolicy: async () => ({ autoClose: true, autoCloseTime: '19:00', timezone: 'Asia/Kolkata' }) } as any,
        clock, new AttendanceAuthorityService(prisma), workday,
      );
    }

    async function openDayAtNow() {
      const loginAt = new Date('2026-08-13T03:30:00.000Z');
      await prisma.user.update({ where: { id: W }, data: { currentStatus: 'WORKING', lastActiveAt: new Date('2026-08-13T04:00:00.000Z') } });
      return prisma.workSession.create({
        data: { userId: W, date: new Date('2026-08-13T00:00:00.000Z'), loginAt, startWorkAt: loginAt, status: 'WORKING' },
      });
    }

    it('auto-close holds the session: a concurrent creation waits, then is refused', async () => {
      const clock = clockAt(NOW);
      const ticketsAtNow = makeTickets(clock);
      const session = await openDayAtNow();
      const pause = pauseNextTransactionAfter('workSession', 'findUnique', 1);
      const closing = makeScheduler(clock).autoCloseMidnightSessions();
      await parked(pause, closing);

      resetEffects();
      const creating = ticketsAtNow.create(body(), W, actor(W)).then(() => null, (e) => e);
      await waitUntilSomeoneWaitsForALock();

      pause.release();
      await closing;
      const err = await creating;
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: ACTIVE_WORKDAY_REQUIRED });
      expect(await count('tickets')).toBe(0);
      expect(await prisma.workSession.findUnique({ where: { id: session.id } })).toMatchObject({ status: 'AUTO_CLOSED' });
      expect(effects.gateway.emitTicketCreated).not.toHaveBeenCalled();
    });

    it('creation holds the session: auto-close waits, the ticket commits, then the day closes', async () => {
      const clock = clockAt(NOW);
      const ticketsAtNow = makeTickets(clock);
      const session = await openDayAtNow();
      const pause = pauseNextTransactionAfter('$queryRaw', null, 1);
      const creating = ticketsAtNow.create(body(), W, actor(W));
      await parked(pause, creating);

      const closing = makeScheduler(clock).autoCloseMidnightSessions();
      await waitUntilSomeoneWaitsForALock();

      pause.release();
      const created = await creating;
      await closing;
      await expectCreatedWithoutTimer(created, W);
      expect(await prisma.workSession.findUnique({ where: { id: session.id } })).toMatchObject({ status: 'AUTO_CLOSED' });
      expect(await auditClean(NOW)).toBe('CLEAN');
    });
  });

  // ── 2. Creation is one transaction and never starts a timer ───────────────

  describe('creation writes', () => {
    beforeEach(async () => {
      await workday.startWork(W);
      await workday.startWork(M);
      resetEffects();
    });

    it('a body asking for IN_PROGRESS still creates an OPEN ticket with no timer', async () => {
      const created = await tickets.create(body({ status: 'IN_PROGRESS', estimatedMinutes: 30 }), M, actor(M));
      await expectCreatedWithoutTimer(created, M);
      expect(await activeFor(W)).toHaveLength(0);
    });

    it('the ticket, its assignees and its activity log commit together', async () => {
      const created = await tickets.create(body({ assigneeIds: [W, M] }), M, actor(M));
      expect(await count('ticket_assignees', `"ticketId" = '${created.id}'`)).toBe(2);
      await expectCreatedWithoutTimer(created, M);
    });

    it('a failed activity-log write rolls the ticket and its assignees back, and nothing is announced', async () => {
      const before = await snapshot();
      failNextTransactionOn('activityLog', 'create');
      await expect(tickets.create(body(), M, actor(M))).rejects.toThrow(/forced activityLog.create failure/);
      expect(await snapshot()).toEqual(before);
      expectNothingAnnounced();
    });

    it('bulk creation (also used by Excel import) is gated the same way, all-or-nothing', async () => {
      const due = new Date(Date.now() + 86_400_000).toISOString();
      const rows = [body({ dueDate: due }), body({ dueDate: due })];
      const created = await tickets.createBulk(rows, M, actor(M));
      expect(created).toHaveLength(2);
      expect(await count('ticket_time_logs')).toBe(0);

      await workday.endWork(M);
      await expectRefused(() => tickets.createBulk([body({ dueDate: due })], M, actor(M)));
    });

    it('optional estimate and optional Start Time: a ticket with neither is created', async () => {
      const created = await tickets.create(body({ estimatedMinutes: '', scheduledStartAt: undefined }), M, actor(M));
      expect(await ticketRow(created.id)).toMatchObject({ estimatedMinutes: null, scheduledStartAt: null, executionDueAt: null });
    });
  });

  // ── 3. Starting work needs a primary owner ────────────────────────────────

  describe('OPEN → IN_PROGRESS needs a primary assignee', () => {
    beforeEach(async () => {
      await workday.startWork(W);
      resetEffects();
    });

    async function expectPrimaryRequired(act: () => Promise<unknown>, ticketId: string) {
      const err = await act().then(() => null, (e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({ statusCode: 400, code: PRIMARY_ASSIGNEE_REQUIRED });
      expect(await ticketRow(ticketId)).toMatchObject({ status: 'OPEN', actualStartAt: null });
      expect(await count('ticket_time_logs', `"ticketId" = '${ticketId}'`)).toBe(0);
      expect(await count('ticket_history', `"ticketId" = '${ticketId}'`)).toBe(0);
      expectNothingAnnounced();
    }

    it('no assignee at all: rejected', async () => {
      const t = await fixtureTicket({ assignedToId: null });
      await expectPrimaryRequired(() => tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, M), t.id);
    });

    it('only a secondary assignee: rejected', async () => {
      const t = await fixtureTicket({ assignedToId: null });
      await prisma.ticketAssignee.create({ data: { ticketId: t.id, userId: W } });
      await expectPrimaryRequired(() => tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, M), t.id);
    });

    it('clearing the primary in the same request: rejected', async () => {
      const t = await fixtureTicket();
      await expectPrimaryRequired(() => tickets.update(t.id, { status: TicketStatus.IN_PROGRESS, assignedToId: null }, M), t.id);
    });

    it('assigning the primary in the same request: allowed, and that person\'s timer starts', async () => {
      const t = await fixtureTicket({ assignedToId: null });
      await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS, assignedToId: W }, M);
      expect(await ticketRow(t.id)).toMatchObject({ status: 'IN_PROGRESS', assignedToId: W });
      expect((await activeFor(W)).map((l) => l.ticketId)).toEqual([t.id]);
    });

    it('an existing primary: allowed', async () => {
      const t = await fixtureTicket();
      await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
      expect((await activeFor(W)).map((l) => l.ticketId)).toEqual([t.id]);
    });

    const ownerlessInProgress = () =>
      count('tickets', `status = 'IN_PROGRESS' AND "assignedToId" IS NULL`);

    it('every transition into IN_PROGRESS needs a primary: REVIEW (direct and reject) and DONE reopen are refused too', async () => {
      for (const from of [TicketStatus.REVIEW, TicketStatus.DONE]) {
        const t = await fixtureTicket({ status: from, assignedToId: null });
        await prisma.ticketAssignee.create({ data: { ticketId: t.id, userId: W } });
        const err = await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, M).then(() => null, (e) => e);
        expect((err as BadRequestException).getResponse()).toMatchObject({ code: PRIMARY_ASSIGNEE_REQUIRED });
        expect((await ticketRow(t.id))!.status).toBe(from);
      }
      const r = await fixtureTicket({ status: TicketStatus.REVIEW, assignedToId: null });
      const err = await tickets.reject(r.id, 'redo', M).then(() => null, (e) => e);
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: PRIMARY_ASSIGNEE_REQUIRED });
      expect(await count('review_cycle_logs', `"ticketId" = '${r.id}'`)).toBe(0); // the decision rolled back too
      expect(await ownerlessInProgress()).toBe(0);
      expect(await count('ticket_time_logs')).toBe(0);
    });

    it('race: unassign commits first while a start waits on the ticket row → the start is refused, no timer', async () => {
      const t = await fixtureTicket(); // OPEN, owner W
      // Unassign parked right after it locked and re-read the ticket row.
      const pause = pauseNextTransactionAfter('$queryRaw', null, 1);
      const unassigning = tickets.unassignPrimary(t.id, M);
      await parked(pause, unassigning);

      // The start validated against the old owner, then queues on the row lock.
      const starting = tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, M).then(() => null, (e) => e);
      await waitUntilSomeoneWaitsForALock();

      pause.release();
      await unassigning;
      const err = await starting;
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: PRIMARY_ASSIGNEE_REQUIRED });
      expect(await ticketRow(t.id)).toMatchObject({ status: 'OPEN', assignedToId: null });
      expect(await activeFor(W)).toHaveLength(0);
      expect(await ownerlessInProgress()).toBe(0);
      expect(await auditClean()).toBe('CLEAN');
    });

    it('race: a start commits first while unassign waits on the ticket row → unassign sees IN_PROGRESS and moves it back to OPEN', async () => {
      const t = await fixtureTicket(); // OPEN, owner W
      // The start parked right after it locked and re-read the ticket row.
      const pause = pauseNextTransactionAfter('$queryRaw', null, 1);
      const starting = tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, M);
      await parked(pause, starting);

      // Unassign read OPEN before its transaction, then queues on the row lock.
      const unassigning = tickets.unassignPrimary(t.id, M);
      await waitUntilSomeoneWaitsForALock();

      pause.release();
      await starting;
      await unassigning;
      expect(await ticketRow(t.id)).toMatchObject({ status: 'OPEN', assignedToId: null });
      expect(await activeFor(W)).toHaveLength(0);
      const history = await prisma.ticketHistory.findMany({ where: { ticketId: t.id, field: 'status' }, orderBy: [{ changedAt: 'asc' }, { id: 'asc' }] });
      expect(history.map((h) => `${h.oldValue}→${h.newValue}`)).toEqual(['OPEN→IN_PROGRESS', 'IN_PROGRESS→OPEN']);
      expect(await ownerlessInProgress()).toBe(0);
      expect(await auditClean()).toBe('CLEAN');
    });
  });

  // ── 4. Rework runs on its own estimate and the TVA clock ──────────────────

  describe('rework', () => {
    /** W's ticket, worked and submitted: REVIEW with an original estimate of 120 minutes. */
    async function inReview() {
      await workday.startWork(W);
      const t = await fixtureTicket({ estimatedMinutes: 120 });
      await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
      await tickets.update(t.id, { status: TicketStatus.REVIEW }, W);
      resetEffects();
      return t;
    }
    /**
     * Tickets and ledger on one TVA clock set a few minutes ahead of the wall
     * clock: every stamp the rework writes must come from it, never new Date().
     */
    function onTvaClock() {
      const at = new Date(Math.floor(Date.now() / 1000) * 1000 + 5 * 60_000);
      const clock = clockAt(at);
      return { at, service: makeTickets(clock, new TicketLedgerService(prisma, clock)) };
    }
    const cycleOf = (ticketId: string) =>
      prisma.reviewCycleLog.findFirst({ where: { ticketId, decision: 'REWORK' }, orderBy: { cycleNo: 'desc' } });

    it('reject with a rework estimate: due time = rework start + that estimate, on the TVA clock', async () => {
      const t = await inReview();
      const { at, service } = onTvaClock();
      await service.reject(t.id, 'tighten the copy', M, undefined, 30);
      const cycle = await cycleOf(t.id);
      expect(cycle).toMatchObject({ reworkEstimatedMinutes: 30, reworkStartedAt: at });
      expect((await ticketRow(t.id))!.executionDueAt).toEqual(new Date(at.getTime() + 30 * 60_000));
      const ticket = await makeTickets(tva).findOne(t.id);
      expect(ticket.workBudget).toMatchObject({ cycle: 'REWORK', estimatedMinutes: 30 });
      expect((await activeFor(W))[0]).toMatchObject({ stage: 'REWORK', startedAt: at });
      expect(await auditClean(new Date(at.getTime() + 60_000))).toBe('CLEAN');
    });

    it('reject without a rework estimate: no due time, never the original 120-minute estimate', async () => {
      const t = await inReview();
      await tickets.reject(t.id, 'redo', M);
      expect((await ticketRow(t.id))!.executionDueAt).toBeNull();
      const ticket = await tickets.findOne(t.id);
      expect(ticket.workBudget).toMatchObject({ cycle: 'REWORK', estimatedMinutes: null });
    });

    it('the original cycle keeps its totals, and a non-work repair row never counts as rework time', async () => {
      await workday.startWork(W);
      const t = await fixtureTicket({ estimatedMinutes: 120 });
      await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
      // Ten minutes of original work, so the totals are not trivially zero.
      await prisma.ticketTimeLog.updateMany({
        where: { ticketId: t.id, endedAt: null },
        data: { startedAt: new Date(Date.now() - 10 * 60_000) },
      });
      await tickets.update(t.id, { status: TicketStatus.REVIEW }, W);
      const before = (await tickets.findOne(t.id)).timers;
      expect(before.original.actualSeconds).toBeGreaterThanOrEqual(600);

      const { at, service } = onTvaClock();
      await service.reject(t.id, 'redo', M, undefined, 45);
      await prisma.ticketTimeLog.create({
        data: {
          ticketId: t.id, userId: W, stage: 'REWORK', ownerType: 'ASSIGNEE', source: 'SYSTEM',
          startedAt: new Date(at.getTime() + 1_000), endedAt: new Date(at.getTime() + 601_000), durationSeconds: 600,
          countsAsWork: false, pauseReason: 'INTEGRITY_REPAIR',
        } as any,
      });

      const later = new Date(at.getTime() + 700_000);
      const laterClock = clockAt(later);
      const after = (await makeTickets(laterClock, new TicketLedgerService(prisma, laterClock)).findOne(t.id));
      expect(after.timers.original).toEqual(before.original);
      expect(after.timers.reworks).toEqual([expect.objectContaining({ estimatedMinutes: 45, actualSeconds: 700, open: true })]);
      expect(after.workBudget).toMatchObject({ cycle: 'REWORK', estimatedMinutes: 45, workedSeconds: 700 });
    });

    it('editing the original estimate during an open rework keeps the rework due date', async () => {
      const t = await inReview();
      const { at, service } = onTvaClock();
      await service.reject(t.id, 'tighten the copy', M, undefined, 30);
      const reworkDue = new Date(at.getTime() + 30 * 60_000);
      expect((await ticketRow(t.id))!.executionDueAt).toEqual(reworkDue);

      await service.update(t.id, { estimatedMinutes: 600 }, M);
      expect(await ticketRow(t.id)).toMatchObject({ estimatedMinutes: 600, executionDueAt: reworkDue });
      const ticket = await service.findOne(t.id);
      expect(ticket.workBudget).toMatchObject({ cycle: 'REWORK', estimatedMinutes: 30 });
    });

    it('race: a rework opens after an estimate edit prepared its due date → the edit keeps the rework due date', async () => {
      await workday.startWork(W);
      const t = await fixtureTicket({ estimatedMinutes: 120 });
      await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);

      // The edit reads the ticket in its original cycle and prepares a due date
      // from the original estimate, then waits before its transaction opens.
      const hold = holdNextTransactionStart();
      const editing = tickets.update(t.id, { estimatedMinutes: 600 }, M);
      await parked(hold, editing);

      // Meanwhile the ticket is submitted and sent back with a 30-minute rework.
      await tickets.update(t.id, { status: TicketStatus.REVIEW }, W);
      const { at, service } = onTvaClock();
      await service.reject(t.id, 'tighten the copy', M, undefined, 30);
      const reworkDue = new Date(at.getTime() + 30 * 60_000);
      expect((await ticketRow(t.id))!.executionDueAt).toEqual(reworkDue);

      hold.release();
      await editing;
      expect(await ticketRow(t.id)).toMatchObject({ estimatedMinutes: 600, executionDueAt: reworkDue });
    });

    it('editing the original estimate during a rework with no estimate keeps "no due time"', async () => {
      const t = await inReview();
      await tickets.reject(t.id, 'redo', M);
      await tickets.update(t.id, { estimatedMinutes: 600 }, M);
      expect(await ticketRow(t.id)).toMatchObject({ estimatedMinutes: 600, executionDueAt: null });
    });

    it('outside a rework, editing the estimate still recalculates the due date (unchanged behaviour)', async () => {
      await workday.startWork(W);
      const t = await fixtureTicket({ estimatedMinutes: 120 });
      await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
      const started = (await ticketRow(t.id))!.actualStartAt!;
      await tickets.update(t.id, { estimatedMinutes: 45 }, M);
      expect((await ticketRow(t.id))!.executionDueAt).toEqual(new Date(started.getTime() + 45 * 60_000));
    });

    it('direct REVIEW → IN_PROGRESS: rework cycle stamped on the TVA clock, no due time', async () => {
      const t = await inReview();
      const { at, service } = onTvaClock();
      await service.update(t.id, { status: TicketStatus.IN_PROGRESS }, M);
      expect(await cycleOf(t.id)).toMatchObject({ reworkStartedAt: at, reworkEstimatedMinutes: null });
      expect((await ticketRow(t.id))!.executionDueAt).toBeNull();
      expect(await activeFor(W)).toEqual([expect.objectContaining({ stage: 'REWORK', startedAt: at })]);
      expect(await auditClean(new Date(at.getTime() + 60_000))).toBe('CLEAN');
    });
  });
});
