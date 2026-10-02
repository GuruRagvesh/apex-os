/**
 * Phase 2D2 against real PostgreSQL: a ticket or workday change and the
 * employee-timer change it requires commit together or roll back together.
 *
 * Forced failures are injected into the REAL transaction client the service
 * opens, on the exact model operation under test:
 *   - timer failure       the ledger's own write (ticket_time_logs create/update)
 *                         fails, after the business writes already ran in the
 *                         same transaction → every business write rolls back;
 *   - reverse failure     a business write that runs AFTER the timer change
 *                         fails → the timer change rolls back too.
 * In both directions nothing is announced: no websocket event, in-process event,
 * notification or operational-event log is emitted for a change that did not
 * commit.
 *
 * Real: Prisma, PostgreSQL, the advisory locks, the one-active-timer unique
 * index, TicketLedgerService, WorkdayService, TicketsService. Doubled: the
 * websocket gateway, notifications, event bus, operational event log (all
 * recorded), permissions and the SLA decorator.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { ConflictException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ActiveWorkdayPolicyService } from '../../src/common/services/active-workday-policy.service';
import { AttendanceAuthorityService } from '../../src/common/services/attendance-authority.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { ONE_ACTIVE_INDEX, oneActiveIndexState } from './one-active-index';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const W = 'u-atomic-worker';
const W2 = 'u-atomic-worker-2';
const M = 'u-atomic-manager';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('T5 atomic ticket/workday + timer transitions (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: TicketLedgerService;
  let workday: WorkdayService;
  let tickets: TicketsService;
  let seq = 0;

  // Everything that must only ever happen after a commit.
  const effects = {
    gateway: { emitTicketStatusChanged: jest.fn(), emitTicketCreated: jest.fn() },
    notifications: { sendNotification: jest.fn(async () => null) },
    bus: { emit: jest.fn(() => true) },
    eventLog: { log: jest.fn(async () => undefined) },
  };
  const resetEffects = () => Object.values(effects).forEach((o) => Object.values(o).forEach((f) => (f as jest.Mock).mockClear()));
  const expectNothingAnnounced = () => {
    expect(effects.gateway.emitTicketStatusChanged).not.toHaveBeenCalled();
    expect(effects.notifications.sendNotification).not.toHaveBeenCalled();
    expect(effects.bus.emit).not.toHaveBeenCalled();
    expect(effects.eventLog.log).not.toHaveBeenCalled();
  };

  /**
   * Makes ONE operation fail inside the next transaction the service opens.
   * `after: true` lets the write happen first, then fails — the "mutation had
   * already begun" case. Nothing outside that transaction is touched.
   */
  function failNextTransactionOn(model: string, op: string, opts: { after?: boolean } = {}) {
    const original = prisma.$transaction.bind(prisma);
    return jest.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: any, txOpts: any) =>
      original((tx: any) => fn(new Proxy(tx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (prop !== model) return typeof value === 'function' ? value.bind(target) : value;
          return new Proxy(value, {
            get(delegate, method) {
              const fnValue = Reflect.get(delegate, method, delegate);
              if (method !== op) return typeof fnValue === 'function' ? fnValue.bind(delegate) : fnValue;
              return async (...args: any[]) => {
                if (opts.after) await fnValue.apply(delegate, args);
                throw new Error(`forced ${model}.${op} failure`);
              };
            },
          });
        },
      })), txOpts)) as any);
  }

  async function newTicket(fields: Record<string, any> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        ticketId: `TKT-T5-${seq}`,
        title: `Atomic fixture ${seq}`,
        category: 'IT',
        type: 'TASK',
        createdById: M,
        assignedToId: W,
        estimatedMinutes: 120,
        ...fields,
      } as any,
    });
  }

  const ticketRow = (id: string) => prisma.ticket.findUnique({ where: { id } });
  const activeLogs = (userId: string) =>
    prisma.ticketTimeLog.findMany({ where: { userId, ownerType: 'ASSIGNEE', endedAt: null } });
  const count = (table: string, where = 'TRUE') =>
    prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`).then((r) => r[0].n as number);
  const userStatus = async (id: string) => (await prisma.user.findUnique({ where: { id } }))!.currentStatus;
  const latestSession = (userId: string) =>
    prisma.workSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, include: { breakLogs: true } });

  /** A table-level fingerprint of everything these flows can write. */
  async function snapshot() {
    const out: Record<string, string> = {};
    for (const table of [
      'tickets', 'ticket_time_logs', 'ticket_history', 'activity_logs', 'ticket_assignees', 'review_cycle_logs',
      'comments', 'work_sessions', 'break_logs', 'attendance_events', 'users',
    ]) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ${table} t`,
      );
      out[table] = `${row.n}:${row.h}`;
    }
    return out;
  }

  /** Runs `act`, which must fail, and proves the database is byte-identical and nothing was announced. */
  async function expectFullRollback(act: () => Promise<unknown>, message = /forced .* failure/) {
    const before = await snapshot();
    resetEffects();
    await expect(act()).rejects.toThrow(message);
    expect(await snapshot()).toEqual(before);
    expectNothingAnnounced();
  }

  /** A review decision needs the decider's running review: the manager starts it. */
  async function managerReviews(ticketId: string) {
    if ((await prisma.workSession.count({ where: { userId: M, status: 'WORKING' } })) === 0) {
      await workday.startWork(M);
    }
    await tickets.startReview(ticketId, M);
  }

  /** W has ticket `t` running (IN_PROGRESS, active ASSIGNEE log). */
  async function running(fields: Record<string, any> = {}) {
    const t = await newTicket(fields);
    await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, fields.assignedToId ?? W);
    return t;
  }

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
      prisma,
      effects.gateway as any,
      effects.notifications as any,
      { get: () => undefined } as any,
      effects.bus as any,
      effects.eventLog as any,
      { isSelfAssigned: () => false } as any,
      { resolvePrimaryApproverFor: async () => null } as any,
      { getSlaConfig: async () => ({ review: { MEDIUM: 24 } }), decorateTicket: async (t: any) => t } as any,
      ledger,
      {} as any,
      new ActiveWorkdayPolicyService(tva),
      tva,
    );
    expect((await oneActiveIndexState(prisma)).valid).toBe(true);
  });

  beforeEach(async () => {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.role.createMany({
      data: [
        { id: 'r-t5-manager', name: 'MANAGER', level: 2 },
        { id: 'r-t5-employee', name: 'EMPLOYEE', level: 4 },
      ] as any,
    });
    for (const [id, roleId] of [[W, 'r-t5-employee'], [W2, 'r-t5-employee'], [M, 'r-t5-manager']]) {
      await prisma.user.create({
        data: { id, roleId, name: id, email: `${id}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE' } as any,
      });
    }
    await workday.startWork(W);
    resetEffects();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    // No fixtures survive: a post-run integrity audit must read CLEAN.
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  // ── Ticket paths: forced timer failure rolls the business change back ─────

  describe('ticket changes roll back when the timer change fails', () => {
    it('OPEN → IN_PROGRESS: the timer start fails → still OPEN, no history, no timer, nothing announced', async () => {
      const t = await newTicket();
      failNextTransactionOn('ticketTimeLog', 'create');
      await expectFullRollback(() => tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W));
      expect((await ticketRow(t.id))!.status).toBe('OPEN');
      expect((await ticketRow(t.id))!.actualStartAt).toBeNull();
      expect(await activeLogs(W)).toHaveLength(0);
    });

    it('IN_PROGRESS → REVIEW: the timer stop fails → still IN_PROGRESS and running', async () => {
      const t = await running();
      failNextTransactionOn('ticketTimeLog', 'update');
      await expectFullRollback(() => tickets.update(t.id, { status: TicketStatus.REVIEW }, W));
      expect((await ticketRow(t.id))!).toMatchObject({ status: 'IN_PROGRESS', submittedAt: null });
      expect((await activeLogs(W)).map((l) => l.ticketId)).toEqual([t.id]);
    });

    it('IN_PROGRESS → DONE: the timer stop fails → still IN_PROGRESS, not completed', async () => {
      const t = await running();
      failNextTransactionOn('ticketTimeLog', 'update');
      await expectFullRollback(() => tickets.update(t.id, { status: TicketStatus.DONE }, W));
      expect((await ticketRow(t.id))!).toMatchObject({ status: 'IN_PROGRESS', actualCompletedAt: null, resolvedAt: null });
    });

    it('reassign/handover: the new assignee\'s start fails → old owner keeps the ticket and the clock', async () => {
      await workday.startWork(W2);
      const t = await running();
      failNextTransactionOn('ticketTimeLog', 'create');
      await expectFullRollback(() => tickets.update(t.id, { assignedToId: W2 }, M));
      expect((await ticketRow(t.id))!.assignedToId).toBe(W);
      expect((await activeLogs(W)).map((l) => l.ticketId)).toEqual([t.id]);
      expect(await activeLogs(W2)).toHaveLength(0);
    });

    it('block: the timer pause fails → not blocked, still running', async () => {
      const t = await running();
      failNextTransactionOn('ticketTimeLog', 'update');
      await expectFullRollback(() => tickets.blockTicket(t.id, 'waiting on vendor', M));
      expect((await ticketRow(t.id))!).toMatchObject({ isBlocked: false, blockedReason: null });
      expect(await activeLogs(W)).toHaveLength(1);
    });

    it('unblock: the timer resume fails → still blocked, no timer', async () => {
      const t = await running();
      await tickets.blockTicket(t.id, 'waiting on vendor', M);
      failNextTransactionOn('ticketTimeLog', 'create');
      await expectFullRollback(() => tickets.unblockTicket(t.id, M));
      expect((await ticketRow(t.id))!.isBlocked).toBe(true);
      expect(await activeLogs(W)).toHaveLength(0);
    });

    it('unassign: the timer stop fails → still assigned, IN_PROGRESS and running', async () => {
      const t = await running();
      failNextTransactionOn('ticketTimeLog', 'update');
      await expectFullRollback(() => tickets.unassignPrimary(t.id, M));
      expect((await ticketRow(t.id))!).toMatchObject({ assignedToId: W, status: 'IN_PROGRESS' });
      expect(await activeLogs(W)).toHaveLength(1);
    });

    it('next-ticket auto-resume: resuming the waiting ticket fails → the REVIEW move rolls back too', async () => {
      const waiting = await running();
      const current = await running(); // switching paused `waiting` (SWITCHED)
      expect((await activeLogs(W)).map((l) => l.ticketId)).toEqual([current.id]);
      failNextTransactionOn('ticketTimeLog', 'create'); // the stop (update) succeeds, the resume (create) fails
      await expectFullRollback(() => tickets.update(current.id, { status: TicketStatus.REVIEW }, W));
      expect((await ticketRow(current.id))!.status).toBe('IN_PROGRESS');
      expect((await activeLogs(W)).map((l) => l.ticketId)).toEqual([current.id]);
      expect((await ticketRow(waiting.id))!.status).toBe('IN_PROGRESS');
    });

    it('rework (reject): the REWORK timer start fails → still REVIEW, no decision, no cycle, no comment', async () => {
      const t = await running();
      await tickets.update(t.id, { status: TicketStatus.REVIEW }, W);
      await managerReviews(t.id);
      failNextTransactionOn('ticketTimeLog', 'create');
      await expectFullRollback(() => tickets.reject(t.id, 'needs another pass', M, undefined, 30));
      expect((await ticketRow(t.id))!).toMatchObject({ status: 'REVIEW', reworkCount: 0 });
      // Phase 4: the submission opened its review cycle; it stays undecided.
      expect(await count('review_cycle_logs')).toBe(1);
      expect(await count('review_cycle_logs', 'decision IS NOT NULL')).toBe(0);
      expect(await count('comments')).toBe(0);
    });
  });

  // ── Reverse direction: a business write after the timer change fails ─────

  describe('the timer change rolls back when a later business write fails', () => {
    it('REVIEW with assignees: the timer already stopped, then the assignee write fails → still running', async () => {
      const t = await running();
      failNextTransactionOn('ticketAssignee', 'deleteMany');
      await expectFullRollback(() => tickets.update(t.id, { status: TicketStatus.REVIEW, assigneeIds: [W] }, W));
      expect((await activeLogs(W)).map((l) => l.ticketId)).toEqual([t.id]);
      expect((await ticketRow(t.id))!.status).toBe('IN_PROGRESS');
    });

    it('reject: the REWORK timer already started, then the comment write fails → no timer, no cycle', async () => {
      const t = await running();
      await tickets.update(t.id, { status: TicketStatus.REVIEW }, W);
      await managerReviews(t.id);
      failNextTransactionOn('comment', 'create');
      await expectFullRollback(() => tickets.reject(t.id, 'needs another pass', M, undefined, 30));
      expect(await activeLogs(W)).toHaveLength(0);
      expect((await ticketRow(t.id))!.status).toBe('REVIEW');
    });

    it('the timer write itself succeeds, then the transaction fails → the write is undone', async () => {
      const t = await newTicket();
      failNextTransactionOn('ticketTimeLog', 'create', { after: true });
      await expectFullRollback(() => tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W));
      expect(await activeLogs(W)).toHaveLength(0);
    });

    it('idle: the back-dated pause already happened, then the IDLE_DETECTED event fails → still WORKING and running', async () => {
      await running();
      failNextTransactionOn('attendanceEvent', 'create');
      await expectFullRollback(() => workday.reportIdle(W, 30));
      expect(await userStatus(W)).toBe('WORKING');
      expect((await latestSession(W))!.status).toBe('WORKING');
      expect(await activeLogs(W)).toHaveLength(1);
    });
  });

  // ── Workday paths: forced timer failure rolls the workday change back ─────

  describe('workday changes roll back when the timer change fails', () => {
    it('Start Break: the pause fails → no break row, still WORKING (session and user), still running', async () => {
      await running();
      failNextTransactionOn('ticketTimeLog', 'update');
      await expectFullRollback(() => workday.startBreak(W, { breakType: 'TEA' }));
      expect(await count('break_logs')).toBe(0);
      expect(await count('attendance_events', `"eventType" = 'BREAK_START'`)).toBe(0);
      expect((await latestSession(W))!.status).toBe('WORKING');
      expect(await userStatus(W)).toBe('WORKING');
      expect(await activeLogs(W)).toHaveLength(1);
    });

    it('End Break: the resume fails → break still open, still ON_BREAK, no timer running', async () => {
      await running();
      await workday.startBreak(W, { breakType: 'TEA' });
      failNextTransactionOn('ticketTimeLog', 'create');
      await expectFullRollback(() => workday.endBreak(W));
      const session = (await latestSession(W))!;
      expect(session.status).toBe('ON_BREAK');
      expect(session.breakLogs.filter((b) => !b.endAt)).toHaveLength(1);
      expect(await userStatus(W)).toBe('ON_BREAK');
      expect(await count('attendance_events', `"eventType" = 'BREAK_END'`)).toBe(0);
      expect(await activeLogs(W)).toHaveLength(0);
    });

    it('Start Work (next session): the ticket resume fails → no new session, still LOGGED_OUT', async () => {
      await running();
      await workday.endWork(W);
      expect(await userStatus(W)).toBe('LOGGED_OUT');
      failNextTransactionOn('ticketTimeLog', 'create');
      await expectFullRollback(() => workday.startWork(W));
      expect(await count('work_sessions', `"userId" = '${W}'`)).toBe(1);
      expect(await userStatus(W)).toBe('LOGGED_OUT');
      expect(await activeLogs(W)).toHaveLength(0);
    });

    it('End Day: the pause fails → session still open and WORKING, user WORKING, still running', async () => {
      await running();
      failNextTransactionOn('ticketTimeLog', 'update');
      await expectFullRollback(() => workday.endWork(W));
      const session = (await latestSession(W))!;
      expect(session).toMatchObject({ status: 'WORKING', logoutAt: null });
      expect(await userStatus(W)).toBe('WORKING');
      expect(await activeLogs(W)).toHaveLength(1);
    });

    it('idle: the back-dated pause fails → not IDLE, still running, no event', async () => {
      await running();
      failNextTransactionOn('ticketTimeLog', 'update');
      await expectFullRollback(() => workday.reportIdle(W, 30));
      expect(await userStatus(W)).toBe('WORKING');
      expect(await count('attendance_events', `"eventType" = 'IDLE_DETECTED'`)).toBe(0);
      expect(await activeLogs(W)).toHaveLength(1);
    });
  });

  // ── Successful atomic paths keep Phase 1 behaviour ────────────────────────

  describe('successful paths', () => {
    it('OPEN has no employee timer; IN_PROGRESS runs one; the change is announced once, after commit', async () => {
      const t = await newTicket();
      expect(await activeLogs(W)).toHaveLength(0);
      resetEffects();
      await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
      expect((await activeLogs(W)).map((l) => l.ticketId)).toEqual([t.id]);
      expect(effects.gateway.emitTicketStatusChanged).toHaveBeenCalledTimes(1);
      expect(effects.bus.emit).toHaveBeenCalledTimes(1);
    });

    it('Start Break pauses the timer and sets ON_BREAK; End Break resumes it and sets WORKING', async () => {
      const t = await running();
      await workday.startBreak(W, { breakType: 'LUNCH' });
      expect(await activeLogs(W)).toHaveLength(0);
      expect(await userStatus(W)).toBe('ON_BREAK');
      expect((await latestSession(W))!.status).toBe('ON_BREAK');

      await workday.endBreak(W);
      expect((await activeLogs(W)).map((l) => l.ticketId)).toEqual([t.id]);
      expect(await userStatus(W)).toBe('WORKING');
      expect((await latestSession(W))!.status).toBe('WORKING');
    });

    it('End Day pauses the timer, closes the session and logs the user out, together', async () => {
      await running();
      await workday.endWork(W);
      expect(await activeLogs(W)).toHaveLength(0);
      expect((await latestSession(W))!).toMatchObject({ status: 'LOGGED_OUT' });
      expect((await latestSession(W))!.logoutAt).not.toBeNull();
      expect(await userStatus(W)).toBe('LOGGED_OUT');
    });

    it('REVIEW ends employee timing; reject starts only a REWORK-stage timer inside the new rework cycle', async () => {
      const t = await running();
      await tickets.update(t.id, { status: TicketStatus.REVIEW }, W);
      expect(await activeLogs(W)).toHaveLength(0);

      await managerReviews(t.id);
      await tickets.reject(t.id, 'needs another pass', M, undefined, 30);
      const [log] = await activeLogs(W);
      expect(log).toMatchObject({ ticketId: t.id, stage: 'REWORK', countsAsWork: true });
      const cycle = await prisma.reviewCycleLog.findFirst({ where: { ticketId: t.id } });
      expect(cycle).toMatchObject({ decision: 'REWORK', reworkEstimatedMinutes: 30, reworkEndedAt: null });
      expect(log.startedAt.getTime()).toBeGreaterThanOrEqual(cycle!.reworkStartedAt!.getTime());
      expect((await ticketRow(t.id))!.reworkCount).toBe(1);
    });

    it('reassignment hands the clock over: the old owner stops, the working new owner starts', async () => {
      await workday.startWork(W2);
      const t = await running();
      await tickets.update(t.id, { assignedToId: W2 }, M);
      expect(await activeLogs(W)).toHaveLength(0);
      expect((await activeLogs(W2)).map((l) => l.ticketId)).toEqual([t.id]);
      const ended = await prisma.ticketTimeLog.findFirst({ where: { userId: W, ticketId: t.id } });
      expect(ended!.pauseReason).toBe('UNASSIGNED');
    });

    it('next-ticket auto-resume picks only an eligible waiting ticket (never a blocked one)', async () => {
      const blocked = await running();
      const eligible = await running();
      const current = await running();
      await tickets.blockTicket(blocked.id, 'blocked on input', M);
      await tickets.update(current.id, { status: TicketStatus.REVIEW }, W);
      expect((await activeLogs(W)).map((l) => l.ticketId)).toEqual([eligible.id]);
    });
  });

  // ── The one-active-timer index under real concurrency ─────────────────────

  describe('unique-index conflict', () => {
    it('two simultaneous starts for one worker: exactly one active timer, both tickets consistent', async () => {
      const a = await newTicket();
      const b = await newTicket();
      await Promise.all([
        tickets.update(a.id, { status: TicketStatus.IN_PROGRESS }, W),
        tickets.update(b.id, { status: TicketStatus.IN_PROGRESS }, W),
      ]);
      // The worker lock serialises them: the second switches the first (SWITCHED).
      expect(await activeLogs(W)).toHaveLength(1);
      expect((await ticketRow(a.id))!.status).toBe('IN_PROGRESS');
      expect((await ticketRow(b.id))!.status).toBe('IN_PROGRESS');
    });

    it('a start that loses to a writer outside the lock is rejected with 409 and leaves no partial change', async () => {
      const other = await newTicket({ status: 'IN_PROGRESS' });
      const t = await newTicket();
      const session = await latestSession(W);

      // An unlocked writer holds an uncommitted active timer for W.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const holder = prisma.$transaction(async (tx) => {
        await tx.ticketTimeLog.create({
          data: { ticketId: other.id, userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', startedAt: new Date(), workSessionId: session!.id } as any,
        });
        await gate;
      }, { timeout: 30_000 });
      await sleep(300);

      const before = await snapshot();
      resetEffects();
      const start = tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
      await sleep(700); // the start's timer insert now waits on the index
      release();
      await holder;

      const err = await start.then(() => null, (e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getStatus()).toBe(409);
      expect(String((err as Error).message)).not.toMatch(/prisma|unique constraint|ticket_time_logs/i);

      // The losing change left nothing behind; only the holder's row is new.
      const after = await snapshot();
      for (const table of ['tickets', 'ticket_history', 'activity_logs']) expect(after[table]).toBe(before[table]);
      expect((await ticketRow(t.id))!.status).toBe('OPEN');
      expect((await activeLogs(W)).map((l) => l.ticketId)).toEqual([other.id]);
      expectNothingAnnounced();

      const index = await oneActiveIndexState(prisma);
      expect(index).toMatchObject({ exists: true, valid: true });
      expect(index.definition).toContain(ONE_ACTIVE_INDEX);
    });
  });

  it('leaves consistent timer data: the Phase 2C audit is CLEAN after a mix of successes and rollbacks', async () => {
    await workday.startWork(W2);
    const t = await running();
    failNextTransactionOn('ticketTimeLog', 'update');
    await expect(workday.startBreak(W, { breakType: 'TEA' })).rejects.toThrow();
    await tickets.update(t.id, { assignedToId: W2 }, M);
    await workday.startBreak(W2, { breakType: 'TEA' });
    await workday.endBreak(W2);
    const audit = await runReadOnlyAudit(prisma as any, { now: new Date(), staleHours: 12, sampleLimit: 5 });
    expect(audit.result).toBe('CLEAN');
  });
});
