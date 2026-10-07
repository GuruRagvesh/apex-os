/**
 * Phase 4 against real PostgreSQL: the reviewer active-work clock, the review
 * decision races, withdrawal, and reviewer analytics.
 *
 * Real: Prisma, PostgreSQL, row and advisory locks, the one-active-timed index,
 * TicketsService (startReview / pauseReview / withdraw / approve / reject /
 * update), TicketLedgerService, WorkdayService, ActiveWorkdayPolicyService,
 * AnalyticsService and DashboardService reviewer metrics. Doubled: websocket
 * gateway, notifications, event bus, operational event log (all recorded),
 * the permission service (a fixed reviewer set, see `access`), the SLA
 * decorator.
 *
 * One mutable TVA clock drives every service, so durations are exact.
 * Races are coordinated with transaction gates and pg_locks, never timed.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ActiveWorkdayPolicyService } from '../../src/common/services/active-workday-policy.service';
import { AttendanceAuthorityService } from '../../src/common/services/attendance-authority.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { AnalyticsService } from '../../src/modules/platform/analytics/analytics.service';
import { DashboardService } from '../../src/modules/platform/dashboard/dashboard.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { oneActiveIndexState } from './one-active-index';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const W = 'u-t8-worker';
const R = 'u-t8-reviewer';
const R2 = 'u-t8-reviewer-2';
const S = 'u-t8-stranger';
const REVIEWERS = new Set([R, R2]);
const userObj = (id: string) => ({ id, role: { name: id === W || id === S ? 'EMPLOYEE' : 'MANAGER' } });

describe('T8 reviewer active-work clock and withdrawal (PostgreSQL)', () => {
  let prisma: PrismaService;
  let tva: TVAService;
  let ledger: TicketLedgerService;
  let workday: WorkdayService;
  let tickets: TicketsService;
  let analytics: AnalyticsService;
  let dashboard: DashboardService;
  let nowMs = 0;
  let seq = 0;

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

  /** Fixed reviewer set; everything else as the real permission service would allow these flows. */
  const access = {
    isSelfAssigned: () => false,
    viewerCanApprove: async (user: any, ticket: any) => ticket?.status === 'REVIEW' && REVIEWERS.has(user?.id),
    viewerCanClose: async () => false,
    findAccessibleTicket: async (id: string, _user: any, include?: any) =>
      prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: include ?? { assignees: true } }),
    assertCanTransitionTicket: async () => undefined,
    assertCanAssignTicket: async () => undefined,
    assertCanUpdateTicket: async () => undefined,
  };

  // ── Clock and coordination ────────────────────────────────────────────────

  const advance = (seconds: number) => { nowMs += seconds * 1000; };
  const now = () => new Date(nowMs);

  function interceptNextTransaction(member: string, op: string | null, hook: (call: number, run: () => Promise<any>) => Promise<any>) {
    const original = prisma.$transaction.bind(prisma);
    let calls = 0;
    jest.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: any, txOpts: any) =>
      original((tx: any) => fn(new Proxy(tx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (prop !== member) return typeof value === 'function' ? value.bind(target) : value;
          if (op === null) {
            return (...args: any[]) => { calls += 1; return hook(calls, () => value.apply(target, args)); };
          }
          return new Proxy(value, {
            get(delegate, method) {
              const fnValue = Reflect.get(delegate, method, delegate);
              if (method !== op) return typeof fnValue === 'function' ? fnValue.bind(delegate) : fnValue;
              return (...args: any[]) => { calls += 1; return hook(calls, () => fnValue.apply(delegate, args)); };
            },
          });
        },
      })), txOpts)) as any);
  }

  function pauseNextTransactionAfter(member: string, op: string | null, nth: number) {
    let reached!: () => void;
    let release!: () => void;
    const reachedP = new Promise<void>((r) => (reached = r));
    const gate = new Promise<void>((r) => (release = r));
    interceptNextTransaction(member, op, async (call, run) => {
      const result = await run();
      if (call === nth) { reached(); await gate; }
      return result;
    });
    return { reached: reachedP, release };
  }

  function failNextTransactionOn(model: string, op: string, opts: { after?: boolean } = {}) {
    interceptNextTransaction(model, op, async (_call, run) => {
      if (opts.after) await run();
      throw new Error(`forced ${model}.${op} failure`);
    });
  }

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
  const activeFor = (userId: string) => prisma.ticketTimeLog.findMany({ where: { userId, endedAt: null } });
  const reviewerRows = (ticketId: string) =>
    prisma.ticketTimeLog.findMany({ where: { ticketId, ownerType: 'REVIEWER' }, orderBy: { startedAt: 'asc' } });
  const cyclesOf = (ticketId: string) => prisma.reviewCycleLog.findMany({ where: { ticketId }, orderBy: { cycleNo: 'asc' } });
  const timersOf = async (id: string) => ledger.getTicketTimers((await ticketRow(id))!);
  const auditClean = async () => (await runReadOnlyAudit(prisma as any, { now: now(), staleHours: 12, sampleLimit: 5 })).result;

  async function snapshot() {
    const out: Record<string, string> = {};
    for (const table of ['tickets', 'ticket_time_logs', 'ticket_history', 'activity_logs', 'review_cycle_logs', 'comments']) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ${table} t`,
      );
      out[table] = `${row.n}:${row.h}`;
    }
    return out;
  }

  async function expectRefused(act: () => Promise<unknown>, status: number, code: string) {
    const before = await snapshot();
    resetEffects();
    const err: any = await act().then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(err.getStatus()).toBe(status);
    expect(err.getResponse()).toMatchObject({ code });
    expect(JSON.stringify(err.getResponse())).not.toMatch(/prisma|ticket_time_logs|index|constraint|P20\d\d/i);
    expect(await snapshot()).toEqual(before);
    expectNothingAnnounced();
    return err;
  }

  async function seedUsers() {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.role.createMany({
      data: [{ id: 'r-t8-manager', name: 'MANAGER', level: 2 }, { id: 'r-t8-employee', name: 'EMPLOYEE', level: 4 }] as any,
    });
    for (const id of [W, R, R2, S]) {
      await prisma.user.create({
        data: {
          id, roleId: id === W || id === S ? 'r-t8-employee' : 'r-t8-manager', name: id,
          email: `${id}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE',
        } as any,
      });
    }
  }

  async function newTicket(fields: Record<string, any> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        ticketId: `TKT-T8-${seq}`, title: `Review fixture ${seq}`, category: 'IT', type: 'TASK',
        createdById: R, assignedToId: W, estimatedMinutes: 120, ...fields,
      } as any,
    });
  }

  /** W worked on a ticket and submitted it: REVIEW, open cycle, no timers. Reviewers are working. */
  async function inReview() {
    const t = await newTicket();
    await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
    advance(600);
    await tickets.update(t.id, { status: TicketStatus.REVIEW }, W);
    resetEffects();
    return t;
  }

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);

    tva = new TVAService({ get: () => undefined } as any);
    jest.spyOn(tva, 'now').mockImplementation(() => new Date(nowMs));
    ledger = new TicketLedgerService(prisma, tva);
    workday = new WorkdayService(
      prisma, {} as any, effects.eventLog as any, ledger, effects.notifications as any,
      new AttendanceAuthorityService(prisma), tva,
    );
    tickets = new TicketsService(
      prisma, effects.gateway as any, effects.notifications as any, { get: () => undefined } as any,
      effects.bus as any, effects.eventLog as any, access as any,
      { resolvePrimaryApproverFor: async () => null, resolveTaskCreationApprover: async () => null } as any,
      { getSlaConfig: async () => ({ review: { LOW: 48, MEDIUM: 24, HIGH: 8, URGENT: 4 } }), decorateTicket: async (t: any) => t } as any,
      ledger, {} as any, new ActiveWorkdayPolicyService(tva), tva,
    );
    const timing = { getSlaConfig: async () => ({ review: { LOW: 48, MEDIUM: 24, HIGH: 8, URGENT: 4 } }) };
    // Ticket scope is not under test here: everything is visible (admin-like).
    analytics = new AnalyticsService(prisma, { buildTicketWhereForUser: async () => ({}) } as any, timing as any, { roleName: () => 'MANAGER' } as any, tva, {} as any);
    dashboard = new DashboardService(prisma, { buildTicketWhereForUser: async () => ({}) } as any, timing as any, {} as any, {} as any, {} as any, tva);
    expect(await oneActiveIndexState(prisma)).toMatchObject({ exists: true, valid: true });
  });

  beforeEach(async () => {
    jest.spyOn(tva, 'now').mockImplementation(() => new Date(nowMs));
    nowMs = Math.floor(Date.now() / 1000) * 1000;
    await seedUsers();
    for (const id of [W, R, R2]) await workday.startWork(id);
    resetEffects();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  // ── 1–6: the reviewer clock ───────────────────────────────────────────────

  it('1. entering REVIEW stops employee timing, opens the review cycle, and starts no reviewer timer', async () => {
    const t = await inReview();
    expect(await activeFor(W)).toHaveLength(0);
    expect(await reviewerRows(t.id)).toHaveLength(0);
    const cycles = await cyclesOf(t.id);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({ decision: null, assigneeId: W });
    expect(await timersOf(t.id)).toMatchObject({ activeClock: 'NONE', reviewerWorkSeconds: 0 });
    expect(await auditClean()).toBe('CLEAN');
  });

  it('2. an unauthorized user cannot start review (403) and nothing is written', async () => {
    const t = await inReview();
    await workday.startWork(S);
    await expectRefused(() => tickets.startReview(t.id, S, userObj(S)), 403, 'REVIEWER_NOT_AUTHORIZED');
  });

  it('3. a punched-out reviewer gets the workday error; a reviewer on break gets REVIEWER_NOT_WORKING', async () => {
    const t = await inReview();
    await workday.endWork(R);
    const err = await expectRefused(() => tickets.startReview(t.id, R, userObj(R)), 409, 'ACTIVE_WORKDAY_REQUIRED');
    expect(err.getResponse().message).toBe('Punch In before starting a review.');

    await workday.startBreak(R2, { breakType: 'TEA' });
    await expectRefused(() => tickets.startReview(t.id, R2, userObj(R2)), 409, 'REVIEWER_NOT_WORKING');
  });

  it('4. Start Review creates exactly one reviewer timer and announces it after commit', async () => {
    const t = await inReview();
    const res = await tickets.startReview(t.id, R, userObj(R));
    const rows = await reviewerRows(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: R, stage: 'REVIEW', ownerType: 'REVIEWER', source: 'REVIEW_ACTION', countsAsWork: true, endedAt: null });
    expect(rows[0].workSessionId).not.toBeNull();
    expect(res.timers).toMatchObject({ activeClock: 'REVIEWER_WORK', active: { userId: R, ownerType: 'REVIEWER' } });
    expect((await cyclesOf(t.id))[0].reviewerId).toBe(R);
    expect(await count('activity_logs', `action = 'REVIEW_STARTED'`)).toBe(1);
    expect(effects.eventLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'TICKET_REVIEW_STARTED' }));
    expect(await auditClean()).toBe('CLEAN');
  });

  it('5/22. Pause records the exact duration; the review SLA clock keeps running while paused', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    advance(900);
    await tickets.pauseReview(t.id, R, userObj(R));
    const [row] = await reviewerRows(t.id);
    expect(row).toMatchObject({ durationSeconds: 900, pauseReason: 'REVIEW_PAUSED' });

    const paused = await timersOf(t.id);
    advance(3600);
    const later = await timersOf(t.id);
    expect(paused).toMatchObject({ activeClock: 'NONE', reviewerWorkSeconds: 900 });
    expect(later.reviewerWorkSeconds).toBe(900); // reviewer work frozen
    expect(later.reviewTurnaroundSeconds - paused.reviewTurnaroundSeconds).toBe(3600); // SLA clock never paused
    expect(await auditClean()).toBe('CLEAN');
  });

  it('6. Start and Pause are idempotent', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    advance(60);
    await tickets.startReview(t.id, R, userObj(R));
    expect(await reviewerRows(t.id)).toHaveLength(1);
    await tickets.pauseReview(t.id, R, userObj(R));
    resetEffects();
    await tickets.pauseReview(t.id, R, userObj(R));
    expect(await reviewerRows(t.id)).toHaveLength(1);
    expect(effects.eventLog.log).not.toHaveBeenCalled();
  });

  // ── 7–11: one clock per person, workday interplay ─────────────────────────

  /** R timing their own IN_PROGRESS ticket. */
  async function reviewerOwnWork() {
    const own = await newTicket({ assignedToId: R, createdById: R });
    await tickets.update(own.id, { status: TicketStatus.IN_PROGRESS }, R);
    expect((await activeFor(R)).map((l) => l.ownerType)).toEqual(['ASSIGNEE']);
    return own;
  }
  const activeKinds = async (userId: string) => (await activeFor(userId)).map((l) => [l.ownerType, l.ticketId]);

  it('7. Start Review pauses the reviewer\'s own employee timer in the same instant; never two clocks', async () => {
    const t = await inReview();
    const own = await reviewerOwnWork();
    advance(300);
    await tickets.startReview(t.id, R, userObj(R));
    expect(await activeKinds(R)).toEqual([['REVIEWER', t.id]]);
    const paused = await prisma.ticketTimeLog.findFirst({ where: { ticketId: own.id, userId: R }, orderBy: { startedAt: 'desc' } });
    const [review] = await reviewerRows(t.id);
    expect(paused).toMatchObject({ pauseReason: 'REVIEW_SWITCHED', durationSeconds: 300 });
    expect(paused!.endedAt).toEqual(review.startedAt); // no gap, no overlap
    expect(await auditClean()).toBe('CLEAN');
  });

  it('7b. another running review still refuses Start Review (409 OTHER_REVIEW_ACTIVE)', async () => {
    const a = await inReview();
    const b = await inReview();
    await tickets.startReview(a.id, R, userObj(R));
    await expectRefused(() => tickets.startReview(b.id, R, userObj(R)), 409, 'OTHER_REVIEW_ACTIVE');
    expect(await activeKinds(R)).toEqual([['REVIEWER', a.id]]);
  });

  it('7c. Pause Review resumes the exact employee ticket the review paused', async () => {
    const t = await inReview();
    const own = await reviewerOwnWork();
    const other = await newTicket({ assignedToId: R, createdById: R, status: 'IN_PROGRESS' }); // also waiting
    advance(60);
    await tickets.startReview(t.id, R, userObj(R));
    advance(600);
    await tickets.pauseReview(t.id, R, userObj(R));
    expect(await activeKinds(R)).toEqual([['ASSIGNEE', own.id]]);
    expect(other.id).not.toBe(own.id);
    expect(await auditClean()).toBe('CLEAN');
  });

  it('7d. approval, rejection and withdrawal each hand the reviewer their employee work back', async () => {
    const own = await reviewerOwnWork();
    for (const decide of ['approve', 'reject', 'withdraw'] as const) {
      const t = await inReview();
      advance(30);
      await tickets.startReview(t.id, R, userObj(R));
      expect(await activeKinds(R)).toEqual([['REVIEWER', t.id]]);
      advance(120);
      if (decide === 'approve') {
        await tickets.approve(t.id, R, userObj(R), { taskEfficiencyRating: 4, employeePerformanceRating: 4, employeeAttitudeRating: 4 } as any);
      } else if (decide === 'reject') {
        await tickets.reject(t.id, 'again', R, userObj(R));
      } else {
        await tickets.withdraw(t.id, W, userObj(W));
      }
      expect(await activeKinds(R)).toEqual([['ASSIGNEE', own.id]]);
      expect((await cyclesOf(t.id))[0].reviewerWorkSeconds).toBe(120);
      advance(30);
    }
    expect(await auditClean()).toBe('CLEAN');
  });

  it('7e. on break or End Day nothing resumes at once; the normal workday resume brings employee work back, never review', async () => {
    const t = await inReview();
    const own = await reviewerOwnWork();
    advance(60);
    await tickets.startReview(t.id, R, userObj(R));
    advance(60);
    await workday.startBreak(R, { breakType: 'TEA' });
    expect(await activeFor(R)).toHaveLength(0);
    advance(300);
    await workday.endBreak(R);
    expect(await activeKinds(R)).toEqual([['ASSIGNEE', own.id]]); // workday resume: employee work, not review

    await tickets.startReview(t.id, R, userObj(R));
    advance(60);
    await workday.endWork(R);
    expect(await activeFor(R)).toHaveLength(0);
    advance(60);
    await workday.startWork(R);
    expect(await activeKinds(R)).toEqual([['ASSIGNEE', own.id]]);
    expect(await auditClean()).toBe('CLEAN');
  });

  it('7f. a failure after the switch rolls back both halves: employee work keeps running, no review row', async () => {
    const t = await inReview();
    await reviewerOwnWork();
    const before = await snapshot();
    resetEffects();
    failNextTransactionOn('ticketTimeLog', 'create'); // the reviewer row, written after the employee pause
    await expect(tickets.startReview(t.id, R, userObj(R))).rejects.toThrow(/forced ticketTimeLog.create failure/);
    expect(await snapshot()).toEqual(before);
    expect((await activeFor(R)).map((l) => l.ownerType)).toEqual(['ASSIGNEE']);
    expectNothingAnnounced();
  });

  it('7g. a reviewer starting review racing their own employee timer start: one clock survives', async () => {
    const t = await inReview();
    const own = await newTicket({ assignedToId: R, createdById: R });
    const results = await Promise.allSettled([
      tickets.startReview(t.id, R, userObj(R)),
      tickets.update(own.id, { status: TicketStatus.IN_PROGRESS }, R),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await activeFor(R)).toHaveLength(1);
    expect(await auditClean()).toBe('CLEAN');
  });

  // ── reviewer claim ────────────────────────────────────────────────────────

  it('C1. the first reviewer to start claims the review; another reviewer cannot start, approve or reject it', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    expect((await cyclesOf(t.id))[0].reviewerId).toBe(R);
    await expectRefused(() => tickets.startReview(t.id, R2, userObj(R2)), 409, 'REVIEW_CLAIMED');
    await expectRefused(
      () => tickets.approve(t.id, R2, userObj(R2), { taskEfficiencyRating: 4, employeePerformanceRating: 4, employeeAttitudeRating: 4 } as any),
      409, 'REVIEW_CLAIMED',
    );
    await expectRefused(() => tickets.reject(t.id, 'no', R2, userObj(R2)), 409, 'REVIEW_CLAIMED');
    advance(100);
    await tickets.approve(t.id, R, userObj(R), { taskEfficiencyRating: 4, employeePerformanceRating: 4, employeeAttitudeRating: 4 } as any);
    expect((await cyclesOf(t.id))[0]).toMatchObject({ decision: 'APPROVED', reviewerId: R, reviewerWorkSeconds: 100 });
  });

  it('C2. two reviewers starting at once: exactly one claims, the other gets 409', async () => {
    const t = await inReview();
    const results = await Promise.allSettled([
      tickets.startReview(t.id, R, userObj(R)),
      tickets.startReview(t.id, R2, userObj(R2)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.getResponse()).toMatchObject({ code: 'REVIEW_CLAIMED' });
    const [cycle] = await cyclesOf(t.id);
    const rows = await reviewerRows(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(cycle.reviewerId);
  });

  it('C3. authority is re-checked under the ticket lock', async () => {
    const t = await inReview();
    // Authorized at the pre-check, no longer once the ticket is locked.
    jest.spyOn(access, 'viewerCanApprove').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expectRefused(() => tickets.startReview(t.id, R, userObj(R)), 403, 'REVIEWER_NOT_AUTHORIZED');
  });

  // ── direct status changes out of REVIEW ───────────────────────────────────

  it('D1. a plain REVIEW → DONE status change is refused; only Approve completes a review', async () => {
    const t = await inReview();
    await expectRefused(() => tickets.update(t.id, { status: TicketStatus.DONE }, R), 409, 'REVIEW_DECISION_REQUIRED');
    expect((await cyclesOf(t.id))[0].decision).toBeNull();
  });

  it('D2. REVIEW → OPEN closes the cycle as CANCELLED and stops the reviewer clock; the next submission opens a new cycle', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    advance(50);
    await tickets.update(t.id, { status: TicketStatus.OPEN }, R);
    expect((await reviewerRows(t.id))[0]).toMatchObject({ pauseReason: 'REVIEW_ENDED', durationSeconds: 50 });
    expect((await cyclesOf(t.id))[0]).toMatchObject({ decision: 'CANCELLED', reviewerWorkSeconds: 50 });
    await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
    advance(60);
    await tickets.update(t.id, { status: TicketStatus.REVIEW }, W);
    expect((await cyclesOf(t.id)).map((c) => c.decision)).toEqual(['CANCELLED', null]);
    const m = await analytics.getReviewerMetrics(R, { id: R, role: { name: 'MANAGER' } });
    expect(m.completedApprovalsCount).toBe(0); // a cancellation is not a review decision
    expect(await auditClean()).toBe('CLEAN');
  });

  it('8. two simultaneous reviewer starts by one person leave exactly one active timed ticket', async () => {
    const a = await inReview();
    const b = await inReview();
    const results = await Promise.allSettled([
      tickets.startReview(a.id, R, userObj(R)),
      tickets.startReview(b.id, R, userObj(R)),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(ConflictException);
    expect(await activeFor(R)).toHaveLength(1);
    expect(await auditClean()).toBe('CLEAN');
  });

  it('9a. Start Review holds the session: End Day waits, then closes the reviewer timer (LOGOUT)', async () => {
    const t = await inReview();
    // Parked right after the workday policy share-locked R's session (2nd raw query: ticket row, then session).
    const pause = pauseNextTransactionAfter('$queryRaw', null, 2);
    const starting = tickets.startReview(t.id, R, userObj(R));
    await parked(pause, starting);
    const ending = workday.endWork(R);
    await waitUntilSomeoneWaitsForALock();
    pause.release();
    await starting;
    await ending;
    const [row] = await reviewerRows(t.id);
    expect(row).toMatchObject({ pauseReason: 'LOGOUT' });
    expect(row.endedAt).not.toBeNull();
    expect(await activeFor(R)).toHaveLength(0);
    expect(await auditClean()).toBe('CLEAN');
  });

  it('9b. End Day holds the session: Start Review waits, then is refused with the workday error', async () => {
    const t = await inReview();
    const pause = pauseNextTransactionAfter('workSession', 'findUnique', 1);
    const ending = workday.endWork(R);
    await parked(pause, ending);
    const starting = tickets.startReview(t.id, R, userObj(R)).then(() => null, (e) => e);
    await waitUntilSomeoneWaitsForALock();
    pause.release();
    await ending;
    const err = await starting;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'ACTIVE_WORKDAY_REQUIRED' });
    expect(await reviewerRows(t.id)).toHaveLength(0);
  });

  it('10/11. break and idle pause the reviewer timer atomically; nothing resumes it automatically', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    advance(300);
    await workday.startBreak(R, { breakType: 'TEA' });
    let rows = await reviewerRows(t.id);
    expect(rows[0]).toMatchObject({ pauseReason: 'BREAK', durationSeconds: 300 });
    advance(300);
    await workday.endBreak(R);
    expect(await activeFor(R)).toHaveLength(0); // End Break never resumes review

    await tickets.startReview(t.id, R, userObj(R));
    advance(30 * 60);
    await workday.reportIdle(R, 20); // idle began 20 min ago
    rows = await reviewerRows(t.id);
    expect(rows[1]).toMatchObject({ pauseReason: 'IDLE', durationSeconds: 10 * 60 });
    await workday.resumeWork(R);
    expect(await activeFor(R)).toHaveLength(0); // resuming work never resumes review

    await tickets.startReview(t.id, R, userObj(R));
    advance(120);
    await workday.endWork(R);
    advance(60);
    await workday.startWork(R); // Punch In again
    expect(await activeFor(R)).toHaveLength(0); // never auto-resumed
    expect((await timersOf(t.id)).reviewerWorkSeconds).toBe(300 + 600 + 120);
    expect(await auditClean()).toBe('CLEAN');
  });

  // ── 12–16: decisions and withdrawal ───────────────────────────────────────

  it('12. approval stops reviewer timing and records the exact reviewerWorkSeconds', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    advance(1200);
    await tickets.approve(t.id, R, userObj(R), { taskEfficiencyRating: 5, employeePerformanceRating: 5, employeeAttitudeRating: 5 } as any);
    expect(await activeFor(R)).toHaveLength(0);
    expect((await reviewerRows(t.id))[0]).toMatchObject({ pauseReason: 'REVIEW_DECISION', durationSeconds: 1200 });
    const [cycle] = await cyclesOf(t.id);
    expect(cycle).toMatchObject({ decision: 'APPROVED', reviewerId: R, reviewerWorkSeconds: 1200 });
    expect((await ticketRow(t.id))!.status).toBe('DONE');
    expect(await auditClean()).toBe('CLEAN');
  });

  it('13. rejection stops reviewer timing and opens only the worker\'s rework cycle', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    advance(400);
    await tickets.reject(t.id, 'fix the totals', R, userObj(R), 30);
    expect((await reviewerRows(t.id))[0]).toMatchObject({ pauseReason: 'REVIEW_DECISION', durationSeconds: 400 });
    const [cycle] = await cyclesOf(t.id);
    expect(cycle).toMatchObject({ decision: 'REWORK', reviewerWorkSeconds: 400, reworkEstimatedMinutes: 30 });
    expect(await activeFor(R)).toHaveLength(0);
    expect((await activeFor(W)).map((l) => [l.ownerType, l.stage])).toEqual([['ASSIGNEE', 'REWORK']]);
    expect((await ticketRow(t.id))!.reworkCount).toBe(1);
    expect(await auditClean()).toBe('CLEAN');
  });

  it('14/15. withdrawal: WITHDRAWN, no rework, reviewer clock closed, worker back on normal WORK', async () => {
    const t = await inReview();
    const dueBefore = (await ticketRow(t.id))!.executionDueAt;
    await tickets.startReview(t.id, R, userObj(R));
    advance(200);
    resetEffects();
    await tickets.withdraw(t.id, W, userObj(W), 'found a bug myself');

    const row = (await ticketRow(t.id))!;
    expect(row).toMatchObject({ status: 'IN_PROGRESS', reworkCount: 0, submittedAt: null, reviewStartedAt: null, reviewDueAt: null });
    expect(row.executionDueAt).toEqual(dueBefore);
    const [cycle] = await cyclesOf(t.id);
    expect(cycle).toMatchObject({ decision: 'WITHDRAWN', reviewerWorkSeconds: 200, reworkStartedAt: null, reworkEstimatedMinutes: null });
    expect(cycle.reviewEndedAt).not.toBeNull();
    expect((await reviewerRows(t.id))[0]).toMatchObject({ pauseReason: 'REVIEW_WITHDRAWN', durationSeconds: 200 });
    expect((await activeFor(W)).map((l) => [l.ownerType, l.stage])).toEqual([['ASSIGNEE', 'WORK']]);
    expect(await count('comments', `content = '[WITHDRAWN] found a bug myself'`)).toBe(1);
    expect(await count('activity_logs', `action = 'REVIEW_WITHDRAWN'`)).toBe(1);
    expect(effects.eventLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'TICKET_REVIEW_WITHDRAWN' }));
    expect(await auditClean()).toBe('CLEAN');
  });

  it('14b. only the assignee may withdraw; a reviewer cannot', async () => {
    const t = await inReview();
    await expectRefused(() => tickets.withdraw(t.id, R, userObj(R)), 403, 'WITHDRAW_NOT_ALLOWED');
    await expectRefused(() => tickets.withdraw(t.id, S, userObj(S)), 403, 'WITHDRAW_NOT_ALLOWED');
  });

  it('16a. approval holds the ticket: a concurrent withdrawal waits, then gets 409 — one decision', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    const pause = pauseNextTransactionAfter('$queryRaw', null, 1); // approve's ticket row lock
    const approving = tickets.approve(t.id, R, userObj(R), { taskEfficiencyRating: 4, employeePerformanceRating: 4, employeeAttitudeRating: 4 } as any);
    await parked(pause, approving);
    const withdrawing = tickets.withdraw(t.id, W, userObj(W)).then(() => null, (e) => e);
    await waitUntilSomeoneWaitsForALock();
    pause.release();
    await approving;
    const err = await withdrawing;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'REVIEW_ALREADY_DECIDED' });
    expect((await cyclesOf(t.id)).map((c) => c.decision)).toEqual(['APPROVED']);
    expect((await ticketRow(t.id))!.status).toBe('DONE');
    expect(await auditClean()).toBe('CLEAN');
  });

  it('16b. withdrawal holds the ticket: a concurrent approval waits, then gets 409 — one decision', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    const pause = pauseNextTransactionAfter('$queryRaw', null, 1); // commitUpdate's ticket row lock
    const withdrawing = tickets.withdraw(t.id, W, userObj(W));
    await parked(pause, withdrawing);
    const approving = tickets.approve(t.id, R, userObj(R), { taskEfficiencyRating: 4, employeePerformanceRating: 4, employeeAttitudeRating: 4 } as any).then(() => null, (e) => e);
    await waitUntilSomeoneWaitsForALock();
    pause.release();
    await withdrawing;
    const err = await approving;
    expect(err).toBeInstanceOf(ConflictException);
    expect((await cyclesOf(t.id)).map((c) => c.decision)).toEqual(['WITHDRAWN']);
    expect((await ticketRow(t.id))!.status).toBe('IN_PROGRESS');
    expect(await auditClean()).toBe('CLEAN');
  });

  it('16c. approval versus rejection: the second decision is refused, never recorded', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    const pause = pauseNextTransactionAfter('$queryRaw', null, 1);
    const approving = tickets.approve(t.id, R, userObj(R), { taskEfficiencyRating: 4, employeePerformanceRating: 4, employeeAttitudeRating: 4 } as any);
    await parked(pause, approving);
    const rejecting = tickets.reject(t.id, 'no', R2, userObj(R2)).then(() => null, (e) => e);
    await waitUntilSomeoneWaitsForALock();
    pause.release();
    await approving;
    const err = await rejecting;
    expect(err).toBeInstanceOf(ConflictException);
    expect((await cyclesOf(t.id)).map((c) => c.decision)).toEqual(['APPROVED']);
    expect((await ticketRow(t.id))!.reworkCount).toBe(0);
  });

  it('16d. Start Review racing a withdrawal: whichever locks the ticket first wins, the other re-evaluates', async () => {
    const t = await inReview();
    const pause = pauseNextTransactionAfter('$queryRaw', null, 1); // withdrawal's ticket row lock
    const withdrawing = tickets.withdraw(t.id, W, userObj(W));
    await parked(pause, withdrawing);
    const starting = tickets.startReview(t.id, R, userObj(R)).then(() => null, (e) => e);
    await waitUntilSomeoneWaitsForALock();
    pause.release();
    await withdrawing;
    const err = await starting;
    expect(err.getResponse()).toMatchObject({ code: 'TICKET_NOT_IN_REVIEW' });
    expect(await reviewerRows(t.id)).toHaveLength(0);
    expect(await auditClean()).toBe('CLEAN');
  });

  it('a direct send-back by the worker is a withdrawal too; by a reviewer it is rework', async () => {
    const t = await inReview();
    advance(60);
    await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
    expect((await cyclesOf(t.id))[0].decision).toBe('WITHDRAWN');
    expect((await ticketRow(t.id))!.reworkCount).toBe(0);

    advance(300);
    await tickets.update(t.id, { status: TicketStatus.REVIEW }, W);
    await tickets.startReview(t.id, R, userObj(R)); // a reviewer's send-back needs a started review
    advance(60);
    await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, R);
    expect((await cyclesOf(t.id)).map((c) => c.decision)).toEqual(['WITHDRAWN', 'REWORK']);
    expect((await ticketRow(t.id))!.reworkCount).toBe(1);
    expect(await auditClean()).toBe('CLEAN');
  });

  // ── 17–19: atomicity ──────────────────────────────────────────────────────

  it('17. a reviewer-timer write failure rolls the whole Start Review back', async () => {
    const t = await inReview();
    const before = await snapshot();
    failNextTransactionOn('ticketTimeLog', 'create');
    await expect(tickets.startReview(t.id, R, userObj(R))).rejects.toThrow(/forced ticketTimeLog.create failure/);
    expect(await snapshot()).toEqual(before);
    expectNothingAnnounced();
  });

  it('18. a business write after the timer start fails → the timer is rolled back too', async () => {
    const t = await inReview();
    const before = await snapshot();
    failNextTransactionOn('activityLog', 'create');
    await expect(tickets.startReview(t.id, R, userObj(R))).rejects.toThrow(/forced activityLog.create failure/);
    expect(await snapshot()).toEqual(before);
    expect(await activeFor(R)).toHaveLength(0);
    expectNothingAnnounced();
  });

  it('19. a failed approval (reviewer clock already stopped in the transaction) rolls back and announces nothing', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    advance(100);
    const before = await snapshot();
    resetEffects();
    failNextTransactionOn('ticket', 'update');
    await expect(tickets.approve(t.id, R, userObj(R), { taskEfficiencyRating: 4, employeePerformanceRating: 4, employeeAttitudeRating: 4 } as any)).rejects.toThrow(/forced ticket.update failure/);
    expect(await snapshot()).toEqual(before);
    expect((await activeFor(R)).map((l) => l.ownerType)).toEqual(['REVIEWER']); // still running
    expectNothingAnnounced();
  });

  // ── 20–21: analytics ──────────────────────────────────────────────────────

  it('20/21. repair rows never count; analytics and the dashboard agree on reviewer totals', async () => {
    const a = await inReview();
    await tickets.startReview(a.id, R, userObj(R));
    advance(600);
    await tickets.pauseReview(a.id, R, userObj(R));
    // A non-work integrity repair row inside the review window never counts.
    await prisma.ticketTimeLog.create({
      data: {
        ticketId: a.id, userId: R, stage: 'REVIEW', ownerType: 'REVIEWER', source: 'SYSTEM',
        startedAt: now(), endedAt: new Date(nowMs + 5000), durationSeconds: 5000, countsAsWork: false, pauseReason: 'INTEGRITY_REPAIR',
      } as any,
    });
    advance(60);
    // The decision needs a running review: R resumes it and decides at the same
    // instant, so no further reviewer time accrues.
    await tickets.startReview(a.id, R, userObj(R));
    await tickets.approve(a.id, R, userObj(R), { taskEfficiencyRating: 5, employeePerformanceRating: 5, employeeAttitudeRating: 5 } as any);
    expect((await cyclesOf(a.id))[0].reviewerWorkSeconds).toBe(600);
    expect((await timersOf(a.id)).reviewerWorkSeconds).toBe(600);

    const b = await inReview();
    // Started and decided at the same instant: a decision needs a started
    // review, but zero seconds of it is still an untimed review.
    await tickets.startReview(b.id, R, userObj(R));
    await tickets.reject(b.id, 'redo', R, userObj(R));

    const c = await inReview();
    await tickets.withdraw(c.id, W, userObj(W)); // a withdrawal is not a review of R's

    const m = await analytics.getReviewerMetrics(R, { id: R, role: { name: 'MANAGER' } });
    expect(m).toMatchObject({
      completedApprovalsCount: 2, totalApprovalSeconds: 600, timedReviewsCount: 1, averageApprovalSeconds: 600,
      approvalPercent: 50, rejectionPercent: 50, withdrawnCount: 0,
    });
    const workload = await (dashboard as any).getApprovalWorkload({ id: R, role: { name: 'MANAGER' } });
    expect(workload).toMatchObject({ completedReviews: m.completedApprovalsCount, avgApprovalTime: m.averageApprovalSeconds, slaBreaches: m.approvalSlaBreaches });
    expect(await auditClean()).toBe('CLEAN');
  });

  it('24. employee productivity is unchanged by reviewer time', async () => {
    const t = await inReview();
    const employeeBefore = (await timersOf(t.id)).employeeWorkSeconds;
    await tickets.startReview(t.id, R, userObj(R));
    advance(1800);
    await tickets.pauseReview(t.id, R, userObj(R));
    const timers = await timersOf(t.id);
    expect(timers.employeeWorkSeconds).toBe(employeeBefore);
    expect(timers.employeeWorkSeconds).toBe(600);
    expect(timers.reviewerWorkSeconds).toBe(1800);
    const em = await analytics.getEmployeeMetrics(R, { id: R, role: { name: 'MANAGER' } });
    expect(em.productiveHours).toBe(0); // reviewing is not R's employee work
  });

  it('23. the timer audit is CLEAN after a mix of successes, refusals and rollbacks', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, R, userObj(R));
    failNextTransactionOn('comment', 'create');
    await tickets.reject(t.id, 'x', R, userObj(R)).catch(() => undefined);
    await tickets.startReview(t.id, R2, userObj(R2)).catch(() => undefined); // R claimed it: refused
    advance(90);
    await tickets.approve(t.id, R2, userObj(R2), { taskEfficiencyRating: 3, employeePerformanceRating: 3, employeeAttitudeRating: 3 } as any).catch(() => undefined); // refused
    await tickets.approve(t.id, R, userObj(R), { taskEfficiencyRating: 3, employeePerformanceRating: 3, employeeAttitudeRating: 3 } as any);
    expect(await activeFor(R)).toHaveLength(0);
    expect(await activeFor(R2)).toHaveLength(0);
    expect((await cyclesOf(t.id))[0]).toMatchObject({ decision: 'APPROVED', reviewerId: R, reviewerWorkSeconds: 90 });
    expect(await auditClean()).toBe('CLEAN');
    expect(await oneActiveIndexState(prisma)).toMatchObject({ exists: true, valid: true });
  });
});
