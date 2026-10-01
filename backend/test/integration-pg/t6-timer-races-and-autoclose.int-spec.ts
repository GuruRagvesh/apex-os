/**
 * Phase 2D2 corrections against real PostgreSQL.
 *
 * 1. Timer start vs ticket stop. Transaction A makes a ticket ineligible
 *    (REVIEW / block / unassign / reassign); transaction B is a real End Break
 *    that resumes the same ticket's timer. The two are COORDINATED, never left
 *    to timing:
 *      - "B commits inside A's window": A is paused inside its transaction right
 *        after it first reads the ticket's active timers (still none) and before
 *        it takes any worker lock; B then runs to completion. This is the exact
 *        interleaving of the reported race. A must still see and close B's timer.
 *      - "A holds the lock": A is paused after taking the worker locks; B is
 *        started and the test waits until PostgreSQL shows B blocked on an
 *        ungranted advisory lock (pg_locks). Then A commits; B must find the
 *        ticket ineligible.
 *
 * 2. Scheduler auto-close. The real SchedulerService.autoCloseMidnightSessions()
 *    (policy auto-stop and stale-day branches) closes the session, closes open
 *    breaks, pauses the timer and logs the user out in one transaction; forced
 *    failures on either side roll everything back with no notification or
 *    event, and a retry closes exactly once.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TVAService } from '../../src/common/services/tva.service';
import { AttendanceAuthorityService } from '../../src/common/services/attendance-authority.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { SchedulerService } from '../../src/modules/platform/scheduler/scheduler.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { oneActiveIndexState } from './one-active-index';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const W = 'u-race-worker';
const W2 = 'u-race-worker-2';
const M = 'u-race-manager';

describe('T6 timer races and scheduler auto-close (PostgreSQL)', () => {
  let prisma: PrismaService;
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

  const ticketRow = (id: string) => prisma.ticket.findUnique({ where: { id } });
  const activeOn = (ticketId: string) => prisma.ticketTimeLog.findMany({ where: { ticketId, ownerType: 'ASSIGNEE', endedAt: null } });
  const activeFor = (userId: string) => prisma.ticketTimeLog.findMany({ where: { userId, ownerType: 'ASSIGNEE', endedAt: null } });
  const count = (table: string, where = 'TRUE') =>
    prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`).then((r) => r[0].n as number);
  const userStatus = async (id: string) => (await prisma.user.findUnique({ where: { id } }))!.currentStatus;

  async function snapshot(tables: string[]) {
    const out: Record<string, string> = {};
    for (const table of tables) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ${table} t`,
      );
      out[table] = `${row.n}:${row.h}`;
    }
    return out;
  }

  /** Wraps the NEXT transaction the code opens, with a hook on one model operation. */
  function interceptNextTransaction(model: string, op: string, hook: (call: number, run: () => Promise<any>) => Promise<any>) {
    const original = prisma.$transaction.bind(prisma);
    let calls = 0;
    jest.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: any, txOpts: any) =>
      original((tx: any) => fn(new Proxy(tx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (prop !== model) return typeof value === 'function' ? value.bind(target) : value;
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

  /**
   * Pauses the next transaction right after the `nth` call of model.op returns.
   * `reached` resolves when the transaction is parked there; `release` lets it go on.
   */
  function pauseNextTransactionAfter(model: string, op: string, nth: number) {
    let reached!: () => void;
    let release!: () => void;
    const reachedP = new Promise<void>((r) => (reached = r));
    const gate = new Promise<void>((r) => (release = r));
    interceptNextTransaction(model, op, async (call, run) => {
      const result = await run();
      if (call === nth) {
        reached();
        await gate;
      }
      return result;
    });
    return { reached: reachedP, release };
  }

  /** Makes one operation of the next transaction fail (optionally after it ran). */
  function failNextTransactionOn(model: string, op: string, opts: { after?: boolean } = {}) {
    interceptNextTransaction(model, op, async (_call, run) => {
      if (opts.after) await run();
      throw new Error(`forced ${model}.${op} failure`);
    });
  }

  /** Observable condition, not a sleep: some session is waiting on an advisory lock. */
  async function waitUntilBlockedOnAdvisoryLock(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
      );
      if (row.n > 0) return;
      if (Date.now() > deadline) throw new Error('no transaction became blocked on an advisory lock');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function newTicket(fields: Record<string, any> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        ticketId: `TKT-T6-${seq}`, title: `Race fixture ${seq}`, category: 'IT', type: 'TASK',
        createdById: M, assignedToId: W, estimatedMinutes: 120, ...fields,
      } as any,
    });
  }

  async function seedUsers() {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.role.createMany({
      data: [{ id: 'r-t6-manager', name: 'MANAGER', level: 2 }, { id: 'r-t6-employee', name: 'EMPLOYEE', level: 4 }] as any,
    });
    for (const [id, roleId] of [[W, 'r-t6-employee'], [W2, 'r-t6-employee'], [M, 'r-t6-manager']]) {
      await prisma.user.create({
        data: { id, roleId, name: id, email: `${id}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE' } as any,
      });
    }
  }

  const auditClean = async (now = new Date()) =>
    (await runReadOnlyAudit(prisma as any, { now, staleHours: 12, sampleLimit: 5 })).result;

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    const tva = new TVAService({ get: () => undefined } as any);
    ledger = new TicketLedgerService(prisma, tva);
    workday = new WorkdayService(
      prisma, {} as any, effects.eventLog as any, ledger, effects.notifications as any,
      new AttendanceAuthorityService(prisma), tva,
    );
    tickets = new TicketsService(
      prisma, effects.gateway as any, effects.notifications as any, { get: () => undefined } as any,
      effects.bus as any, effects.eventLog as any, { isSelfAssigned: () => false } as any,
      { resolvePrimaryApproverFor: async () => null } as any,
      { getSlaConfig: async () => ({ review: { MEDIUM: 24 } }), decorateTicket: async (t: any) => t } as any,
      ledger, {} as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  // ── 1. Timer start vs ticket stop ─────────────────────────────────────────

  describe('timer start racing a change that makes the ticket ineligible', () => {
    let t: { id: string };

    /** W is ON_BREAK; ticket t (IN_PROGRESS, W's) was paused by that break. End Break would resume it. */
    beforeEach(async () => {
      await seedUsers();
      await workday.startWork(W);
      await workday.startWork(W2);
      t = await newTicket();
      await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
      await workday.startBreak(W, { breakType: 'TEA' });
      expect(await activeOn(t.id)).toHaveLength(0);
      resetEffects();
    });

    /**
     * Runs A (the change) and, while A is parked right after its first read of
     * the ticket's active timers, runs B (End Break) to completion. Returns A's
     * history/activity deltas and proves nothing of A was announced early.
     */
    async function raceBInsideAsWindow(changeA: () => Promise<unknown>) {
      const history0 = await count('ticket_history', `"ticketId" = '${t.id}'`);
      const activity0 = await count('activity_logs', `"entityId" = '${t.id}'`);
      const pause = pauseNextTransactionAfter('ticketTimeLog', 'findMany', 1);
      const a = changeA();
      await Promise.race([pause.reached, a.then(() => { throw new Error('A finished without reaching the pause point'); })]);
      // A has written the ticket and read "no active timer"

      await workday.endBreak(W); // B: resumes t from the committed IN_PROGRESS state, and commits
      expect((await activeOn(t.id)).map((l) => l.userId)).toEqual([W]); // B's timer exists now
      expect(effects.gateway.emitTicketStatusChanged).not.toHaveBeenCalled(); // A has not committed

      pause.release();
      await a;
      return {
        historyDelta: (await count('ticket_history', `"ticketId" = '${t.id}'`)) - history0,
        activityDelta: (await count('activity_logs', `"entityId" = '${t.id}'`)) - activity0,
      };
    }

    async function expectConsistentEnd() {
      expect(effects.gateway.emitTicketStatusChanged).toHaveBeenCalledTimes(1); // A, once, after commit
      const index = await oneActiveIndexState(prisma);
      expect(index).toMatchObject({ exists: true, valid: true });
      expect(await auditClean()).toBe('CLEAN');
    }

    it('IN_PROGRESS → REVIEW, B commits inside A\'s window: A closes B\'s timer before committing', async () => {
      const d = await raceBInsideAsWindow(() => tickets.update(t.id, { status: TicketStatus.REVIEW }, M));
      expect((await ticketRow(t.id))!.status).toBe('REVIEW');
      expect(await activeOn(t.id)).toHaveLength(0);
      const closed = await prisma.ticketTimeLog.findFirst({ where: { ticketId: t.id, pauseReason: 'STATUS_CHANGE' } });
      expect(closed).not.toBeNull(); // B's resumed segment, closed by A
      expect(d).toEqual({ historyDelta: 1, activityDelta: 1 });
      expect(await userStatus(W)).toBe('WORKING');
      await expectConsistentEnd();
    });

    it('IN_PROGRESS → REVIEW, A holds the worker lock: B waits, then finds the ticket ineligible', async () => {
      const pause = pauseNextTransactionAfter('ticketTimeLog', 'findMany', 2); // the re-read after locking
      // The manager moves it: the worker is on break, and the existing rule
      // "resume work before submitting" (unchanged) would refuse the worker.
      const a = tickets.update(t.id, { status: TicketStatus.REVIEW }, M);
      await Promise.race([pause.reached, a.then(() => { throw new Error('A finished without reaching the pause point'); })]);

      const b = workday.endBreak(W);
      await waitUntilBlockedOnAdvisoryLock(); // B is queued behind A's worker lock
      expect(await activeOn(t.id)).toHaveLength(0);

      pause.release();
      await a;
      await b; // End Break still succeeds; there is just nothing eligible to resume
      expect((await ticketRow(t.id))!.status).toBe('REVIEW');
      expect(await activeOn(t.id)).toHaveLength(0);
      expect(await activeFor(W)).toHaveLength(0);
      expect(await userStatus(W)).toBe('WORKING');
      await expectConsistentEnd();
    });

    it('block, B commits inside A\'s window: blocked, and B\'s timer is closed as BLOCKED', async () => {
      const d = await raceBInsideAsWindow(() => tickets.blockTicket(t.id, 'waiting on vendor', M));
      expect((await ticketRow(t.id))!.isBlocked).toBe(true);
      expect(await activeOn(t.id)).toHaveLength(0);
      expect(await prisma.ticketTimeLog.findFirst({ where: { ticketId: t.id, pauseReason: 'BLOCKED' } })).not.toBeNull();
      expect(d).toEqual({ historyDelta: 1, activityDelta: 1 });
      await expectConsistentEnd();
    });

    it('unassign, B commits inside A\'s window: back to OPEN, unassigned, no timer', async () => {
      const d = await raceBInsideAsWindow(() => tickets.unassignPrimary(t.id, M));
      expect((await ticketRow(t.id))!).toMatchObject({ status: 'OPEN', assignedToId: null });
      expect(await activeOn(t.id)).toHaveLength(0);
      expect(await prisma.ticketTimeLog.findFirst({ where: { ticketId: t.id, userId: W, pauseReason: 'UNASSIGNED' } })).not.toBeNull();
      expect(d).toEqual({ historyDelta: 2, activityDelta: 1 }); // assignee + status rows
      await expectConsistentEnd();
    });

    it('reassignment, B commits inside A\'s window: W\'s raced timer is closed and the clock is handed to W2', async () => {
      const d = await raceBInsideAsWindow(() => tickets.update(t.id, { assignedToId: W2 }, M));
      expect((await ticketRow(t.id))!.assignedToId).toBe(W2);
      expect((await activeOn(t.id)).map((l) => l.userId)).toEqual([W2]);
      expect(await activeFor(W)).toHaveLength(0);
      expect(d).toEqual({ historyDelta: 1, activityDelta: 1 });
      // Reassignment announces the assignment (event bus), not a status change.
      expect(effects.bus.emit).toHaveBeenCalledWith('ticket.assigned', expect.anything());
      expect(await oneActiveIndexState(prisma)).toMatchObject({ exists: true, valid: true });
      expect(await auditClean()).toBe('CLEAN');
    });
  });

  // ── 2. Scheduler auto-close is atomic with presence ───────────────────────

  describe('scheduler auto-close', () => {
    // 2026-08-13 14:00Z = 19:30 IST. Policy cutoff 19:00 IST = 13:30Z.
    const NOW = new Date('2026-08-13T14:00:00.000Z');
    const POLICY_CUTOFF = new Date('2026-08-13T13:30:00.000Z');
    let scheduler: SchedulerService;
    let ticketId: string;

    function makeScheduler(policy: Record<string, any>) {
      const tva = new TVAService({ get: () => undefined } as any);
      jest.spyOn(tva, 'now').mockReturnValue(NOW);
      return new SchedulerService(
        prisma, {} as any, ledger, effects.notifications as any,
        { getWorkdayPolicy: async () => policy } as any, tva,
        new AttendanceAuthorityService(prisma), workday,
      );
    }

    /**
     * W's open session on `day`, an IN_PROGRESS ticket with W's timer running
     * in it (or, onBreak, an open break that already paused the timer).
     */
    async function seedOpenDay(day: string, opts: { onBreak?: boolean } = {}) {
      await seedUsers();
      const loginAt = new Date(`${day}T03:30:00.000Z`);
      await prisma.user.update({
        where: { id: W },
        data: { currentStatus: opts.onBreak ? 'ON_BREAK' : 'WORKING', lastActiveAt: new Date(`${day}T04:00:00.000Z`) },
      });
      const session = await prisma.workSession.create({
        data: { userId: W, date: new Date(`${day}T00:00:00.000Z`), loginAt, startWorkAt: loginAt, status: opts.onBreak ? 'ON_BREAK' : 'WORKING' },
      });
      const ticket = await newTicket({ status: 'IN_PROGRESS', actualStartAt: loginAt });
      ticketId = ticket.id;
      const started = new Date(`${day}T04:00:00.000Z`);
      if (opts.onBreak) {
        const brk = await prisma.breakLog.create({
          data: { userId: W, workSessionId: session.id, breakType: 'LUNCH', startAt: new Date(`${day}T07:00:00.000Z`), source: 'MANUAL_BREAK' },
        });
        await prisma.ticketTimeLog.create({
          data: { ticketId, userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', workSessionId: session.id,
            startedAt: started, endedAt: brk.startAt, durationSeconds: 3 * 3600, pauseReason: 'BREAK', breakLogId: brk.id } as any,
        });
      } else {
        await prisma.ticketTimeLog.create({
          data: { ticketId, userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', workSessionId: session.id, startedAt: started } as any,
        });
      }
      resetEffects();
      return session;
    }

    const TABLES = ['work_sessions', 'break_logs', 'ticket_time_logs', 'users', 'attendance_events'];

    async function expectClosedTogether(sessionId: string, endAt: Date, reason: string) {
      const s = await prisma.workSession.findUnique({ where: { id: sessionId }, include: { breakLogs: true } });
      expect(s).toMatchObject({ status: 'AUTO_CLOSED', closureReason: reason });
      expect(s!.logoutAt).toEqual(endAt);
      expect(s!.breakLogs.every((b) => b.endAt)).toBe(true);
      expect(await activeFor(W)).toHaveLength(0);
      expect(await userStatus(W)).toBe('LOGGED_OUT');
    }

    it('policy auto-stop closes the session, pauses the timer and logs the user out together', async () => {
      const session = await seedOpenDay('2026-08-13');
      scheduler = makeScheduler({ autoClose: true, autoCloseTime: '19:00', timezone: 'Asia/Kolkata' });
      await scheduler.autoCloseMidnightSessions();
      await expectClosedTogether(session.id, POLICY_CUTOFF, 'POLICY_AUTO_STOP');
      const paused = await prisma.ticketTimeLog.findFirst({ where: { ticketId } });
      expect(paused).toMatchObject({ pauseReason: 'POLICY_AUTO_STOP', endedAt: POLICY_CUTOFF });
      expect(effects.notifications.sendNotification).toHaveBeenCalledTimes(1);
      expect(await count('attendance_events', `"eventType" = 'POLICY_AUTO_STOP'`)).toBe(1);
      expect(await auditClean(NOW)).toBe('CLEAN');
    });

    it('stale-day auto-close does the same at the previous day\'s cutoff', async () => {
      const session = await seedOpenDay('2026-08-12');
      scheduler = makeScheduler({ autoClose: true, autoCloseTime: '23:59', timezone: 'Asia/Kolkata' });
      await scheduler.autoCloseMidnightSessions();
      const cutoff = new Date('2026-08-12T18:29:00.000Z'); // 23:59 IST on 2026-08-12
      await expectClosedTogether(session.id, cutoff, 'AUTO_CLOSE');
      expect((await prisma.ticketTimeLog.findFirst({ where: { ticketId } }))).toMatchObject({ pauseReason: 'SYSTEM', endedAt: cutoff });
      expect(effects.notifications.sendNotification).toHaveBeenCalledTimes(1);
      expect(await auditClean(NOW)).toBe('CLEAN');
    });

    it('a user-status failure after the timer pause rolls back the close and the pause; a retry closes exactly once', async () => {
      const session = await seedOpenDay('2026-08-13');
      scheduler = makeScheduler({ autoClose: true, autoCloseTime: '19:00', timezone: 'Asia/Kolkata' });
      const before = await snapshot(TABLES);

      failNextTransactionOn('user', 'update'); // setUserStatus runs after the finalizer paused the timer
      await scheduler.autoCloseMidnightSessions(); // the scheduler logs and swallows per run
      expect(await snapshot(TABLES)).toEqual(before);
      expect((await prisma.workSession.findUnique({ where: { id: session.id } }))!).toMatchObject({ status: 'WORKING', logoutAt: null });
      expect(await activeFor(W)).toHaveLength(1);
      expect(await userStatus(W)).toBe('WORKING');
      expect(effects.notifications.sendNotification).not.toHaveBeenCalled();
      expect(effects.eventLog.log).not.toHaveBeenCalled();

      await scheduler.autoCloseMidnightSessions(); // retry
      await expectClosedTogether(session.id, POLICY_CUTOFF, 'POLICY_AUTO_STOP');
      await scheduler.autoCloseMidnightSessions(); // and again: nothing left to close
      expect(effects.notifications.sendNotification).toHaveBeenCalledTimes(1);
      expect(await count('attendance_events', `"eventType" = 'POLICY_AUTO_STOP'`)).toBe(1);

      // Calling the closer directly on the now-terminal session is a no-op reconciliation.
      const again = await workday.finalizeWorkSessionWithPresence(session.id, {
        effectiveEndAt: NOW, terminalStatus: 'AUTO_CLOSED', closureReason: 'POLICY_AUTO_STOP', autoClosedAt: NOW,
        eventSource: 'system', attendanceEventType: 'POLICY_AUTO_STOP', ticketPauseReason: 'POLICY_AUTO_STOP',
      }, 'LOGGED_OUT');
      expect(again.didClose).toBe(false);
      expect(await count('attendance_events', `"eventType" = 'POLICY_AUTO_STOP'`)).toBe(1);
      expect(await auditClean(NOW)).toBe('CLEAN');
    });

    it('a user-status failure rolls back the open-break closure and totals too', async () => {
      const session = await seedOpenDay('2026-08-12', { onBreak: true });
      scheduler = makeScheduler({ autoClose: true, autoCloseTime: '23:59', timezone: 'Asia/Kolkata' });
      const before = await snapshot(TABLES);

      failNextTransactionOn('user', 'update');
      await scheduler.autoCloseMidnightSessions();
      expect(await snapshot(TABLES)).toEqual(before);
      const s = (await prisma.workSession.findUnique({ where: { id: session.id }, include: { breakLogs: true } }))!;
      expect(s).toMatchObject({ status: 'ON_BREAK', logoutAt: null, totalBreakMinutes: 0 });
      expect(s.breakLogs.filter((b) => !b.endAt)).toHaveLength(1);
      expect(await userStatus(W)).toBe('ON_BREAK');
      expect(effects.notifications.sendNotification).not.toHaveBeenCalled();

      await scheduler.autoCloseMidnightSessions(); // retry
      await expectClosedTogether(session.id, new Date('2026-08-12T18:29:00.000Z'), 'AUTO_CLOSE');
      expect(effects.notifications.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('a timer-pause failure rolls back the user-status change (and the close)', async () => {
      const session = await seedOpenDay('2026-08-13');
      scheduler = makeScheduler({ autoClose: true, autoCloseTime: '19:00', timezone: 'Asia/Kolkata' });
      const before = await snapshot(TABLES);

      failNextTransactionOn('ticketTimeLog', 'update');
      await scheduler.autoCloseMidnightSessions();
      expect(await snapshot(TABLES)).toEqual(before);
      expect(await userStatus(W)).toBe('WORKING');
      expect((await prisma.workSession.findUnique({ where: { id: session.id } }))!.logoutAt).toBeNull();
      expect(await activeFor(W)).toHaveLength(1);
      expect(effects.notifications.sendNotification).not.toHaveBeenCalled();
      expect(effects.eventLog.log).not.toHaveBeenCalled();

      await scheduler.autoCloseMidnightSessions(); // retry
      await expectClosedTogether(session.id, POLICY_CUTOFF, 'POLICY_AUTO_STOP');
      expect(effects.notifications.sendNotification).toHaveBeenCalledTimes(1);
      expect(await count('attendance_events', `"eventType" = 'POLICY_AUTO_STOP'`)).toBe(1);
    });
  });
});
