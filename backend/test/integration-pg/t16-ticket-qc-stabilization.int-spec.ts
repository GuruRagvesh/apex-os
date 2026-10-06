/**
 * Phase 6A ticket QC against real PostgreSQL: the Close permission matrix (the
 * authority for what the UI may offer), close concurrency, task-creation
 * approvals, review-reminder resolution, recent ordering, the type lock,
 * workday auto-close vs ticket status, the created-date filter, the export and
 * the New Ticket planning default.
 *
 * Real: Prisma, PostgreSQL, row locks, TicketsService, TicketLedgerService,
 * WorkdayService and the real permission services over real users, roles and
 * departments. Doubled: websocket gateway, notification sender, event bus,
 * operational event log, the SLA decorator.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ActiveWorkdayPolicyService } from '../../src/common/services/active-workday-policy.service';
import { AttendanceAuthorityService } from '../../src/common/services/attendance-authority.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { HierarchyApprovalService } from '../../src/common/services/hierarchy-approval.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { oneActiveIndexState } from './one-active-index';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const D1 = 'd-t16-ops';
const D2 = 'd-t16-other';
const ADM = 'u-t16-admin';
const MGR = 'u-t16-manager';
const TL = 'u-t16-lead';
const TLX = 'u-t16-lead-other';
const E = 'u-t16-employee';
const E2 = 'u-t16-employee-2';
const I = 'u-t16-intern';
const ROLE_OF: Record<string, string> = {
  [ADM]: 'ADMIN', [MGR]: 'MANAGER', [TL]: 'TEAM_LEAD', [TLX]: 'TEAM_LEAD',
  [E]: 'EMPLOYEE', [E2]: 'EMPLOYEE', [I]: 'INTERN',
};
const DEPT_OF: Record<string, string> = { [TLX]: D2 };
const actor = (id: string) => ({ id, role: { name: ROLE_OF[id] }, departmentId: DEPT_OF[id] ?? D1 });

describe('T16 Phase 6A ticket QC (PostgreSQL)', () => {
  let prisma: PrismaService;
  let tva: TVAService;
  let ledger: TicketLedgerService;
  let workday: WorkdayService;
  let tickets: TicketsService;
  let nowMs = 0;
  let seq = 0;

  const effects = {
    gateway: { emitTicketStatusChanged: jest.fn(), emitTicketCreated: jest.fn() },
    notifications: { sendNotification: jest.fn(async () => null) },
    bus: { emit: jest.fn(() => true) },
    eventLog: { log: jest.fn(async () => undefined) },
  };
  const resetEffects = () => Object.values(effects).forEach((o) => Object.values(o).forEach((f) => (f as jest.Mock).mockClear()));

  const advance = (seconds: number) => { nowMs += seconds * 1000; };
  const now = () => new Date(nowMs);

  // ── Transaction coordination (same technique as t10) ─────────────────────

  function interceptNextTransaction(member: string, op: string, hook: (call: number, run: () => Promise<any>) => Promise<any>) {
    const original = prisma.$transaction.bind(prisma);
    let calls = 0;
    jest.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: any, txOpts: any) =>
      original((tx: any) => fn(new Proxy(tx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (prop !== member) return typeof value === 'function' ? value.bind(target) : value;
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

  function pauseNextTransactionAfter(member: string, op: string, nth: number) {
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

  async function waitUntilSomeoneWaitsForALock(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`);
      if (row.n > 0) return;
      if (Date.now() > deadline) throw new Error('no transaction became blocked on a lock');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  // ── Fixtures ──────────────────────────────────────────────────────────────

  const ticketRow = (id: string) => prisma.ticket.findUnique({ where: { id } });
  const activeFor = (userId: string) => prisma.ticketTimeLog.findMany({ where: { userId, endedAt: null } });
  const statusHistory = (ticketId: string) => prisma.ticketHistory.findMany({ where: { ticketId, field: 'status' } });
  const auditClean = async () => (await runReadOnlyAudit(prisma as any, { now: now(), staleHours: 12, sampleLimit: 5 })).result;

  async function snapshot() {
    const out: Record<string, string> = {};
    for (const table of ['tickets', 'ticket_time_logs', 'ticket_history', 'activity_logs', 'review_cycle_logs', 'notifications']) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ${table} t`,
      );
      out[table] = `${row.n}:${row.h}`;
    }
    return out;
  }

  /** Refused with this status (and code, when given), and nothing was written. */
  async function expectRefused(act: () => Promise<unknown>, status: number, code?: string) {
    const before = await snapshot();
    resetEffects();
    const err: any = await act().then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(err.getStatus()).toBe(status);
    if (code) expect(err.getResponse()).toMatchObject({ code });
    expect(JSON.stringify(err.getResponse())).not.toMatch(/prisma|ticket_time_logs|constraint|P20\d\d/i);
    expect(await snapshot()).toEqual(before);
    expect(effects.gateway.emitTicketStatusChanged).not.toHaveBeenCalled();
    return err;
  }

  async function seed() {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma.department.createMany({ data: [{ id: D1, name: 'T16 Operations' }, { id: D2, name: 'T16 Other' }] as any });
    await prisma.role.createMany({
      data: [
        { id: 'r-t16-admin', name: 'ADMIN', level: 1 },
        { id: 'r-t16-manager', name: 'MANAGER', level: 2 },
        { id: 'r-t16-lead', name: 'TEAM_LEAD', level: 3 },
        { id: 'r-t16-employee', name: 'EMPLOYEE', level: 4 },
        { id: 'r-t16-intern', name: 'INTERN', level: 5 },
      ] as any,
    });
    const roleId: Record<string, string> = {
      ADMIN: 'r-t16-admin', MANAGER: 'r-t16-manager', TEAM_LEAD: 'r-t16-lead', EMPLOYEE: 'r-t16-employee', INTERN: 'r-t16-intern',
    };
    for (const id of Object.keys(ROLE_OF)) {
      await prisma.user.create({
        data: {
          id, roleId: roleId[ROLE_OF[id]], name: id, departmentId: DEPT_OF[id] ?? D1,
          email: `${id}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE',
        } as any,
      });
    }
  }

  async function newTicket(fields: Record<string, any> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        ticketId: `TKT-T16-${seq}`, title: `QC fixture ${seq}`, category: 'IT', type: 'TASK',
        createdById: MGR, assignedToId: E, departmentId: D1, estimatedMinutes: 60, ...fields,
      } as any,
    });
  }

  /** `worker` is timing a ticket: IN_PROGRESS, their timer running. */
  async function inProgress(fields: Record<string, any> = {}, worker = E) {
    const t = await newTicket({ assignedToId: worker, ...fields });
    await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, worker, actor(worker));
    advance(600);
    return t;
  }

  async function inReview(fields: Record<string, any> = {}) {
    const t = await inProgress(fields);
    await tickets.submitForReview(t.id, actor(E), undefined, {
      store: async () => 'test-store://none', discard: async () => undefined,
    });
    advance(60);
    resetEffects();
    return t;
  }

  const close = (id: string, who: string) => tickets.update(id, { status: TicketStatus.CLOSED }, who, actor(who));

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
    const hierarchy = new HierarchyApprovalService(prisma);
    const access = new TicketAccessService(prisma, new AccessPolicyService(prisma), hierarchy);
    tickets = new TicketsService(
      prisma, effects.gateway as any, effects.notifications as any, { get: () => undefined } as any,
      effects.bus as any, effects.eventLog as any, access, hierarchy,
      {
        getSlaConfig: async () => ({ review: { LOW: 48, MEDIUM: 24, HIGH: 8, URGENT: 4 } }),
        decorateTicket: async (t: any) => t,
        decorateTickets: async (ts: any[]) => ts,
      } as any,
      ledger, {} as any, new ActiveWorkdayPolicyService(tva), tva,
    );
    expect(await oneActiveIndexState(prisma)).toMatchObject({ exists: true, valid: true });
  });

  beforeEach(async () => {
    jest.spyOn(tva, 'now').mockImplementation(() => new Date(nowMs));
    nowMs = Math.floor(Date.now() / 1000) * 1000;
    await seed();
    for (const id of [E, E2, I, TL, MGR]) await workday.startWork(id);
    resetEffects();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  // ── E. Close permission matrix ────────────────────────────────────────────

  describe('close permission matrix (authority for the UI)', () => {
    // An OPEN TASK the manager created and assigned to E, in department D1.
    // Every row has four values: jest.each treats a missing trailing argument as done().
    const cases: Array<[string, string, boolean, number]> = [
      ['ADMIN (company-wide)', ADM, true, 200],
      ['MANAGER, in scope', MGR, true, 200],
      ['TEAM_LEAD, in scope', TL, true, 200],
      ['TEAM_LEAD, other department (out of scope)', TLX, false, 403],
      ['EMPLOYEE, the assignee (not the creator)', E, false, 403],
      ['EMPLOYEE, same department, not a participant', E2, false, 403],
      ['INTERN, same department, not a participant', I, false, 403],
    ];
    it.each(cases)('%s', async (_label, who, allowed, status) => {
      const t = await newTicket();
      const viewer = await tickets.findOne(t.id, actor(who)).catch(() => null);
      if (viewer) expect(viewer.viewerCanClose).toBe(allowed);
      if (allowed) {
        await close(t.id, who);
        expect((await ticketRow(t.id))!.status).toBe('CLOSED');
        expect(await statusHistory(t.id)).toHaveLength(1);
      } else {
        await expectRefused(() => close(t.id, who), status);
        expect((await ticketRow(t.id))!.status).toBe('OPEN');
      }
    });

    it('a lead or manager cannot close work assigned to themselves by someone else', async () => {
      const t = await newTicket({ createdById: ADM, assignedToId: MGR });
      expect((await tickets.findOne(t.id, actor(MGR))).viewerCanClose).toBe(false);
      await expectRefused(() => close(t.id, MGR), 403);
    });

    it('a lead may close their own self-created, self-assigned TASK', async () => {
      const t = await newTicket({ createdById: TL, assignedToId: TL });
      expect((await tickets.findOne(t.id, actor(TL))).viewerCanClose).toBe(true);
      await close(t.id, TL);
      expect((await ticketRow(t.id))!.status).toBe('CLOSED');
    });

    it('nobody can change a CLOSED ticket again', async () => {
      const t = await newTicket({ status: 'CLOSED', closedAt: now() });
      expect((await tickets.findOne(t.id, actor(ADM))).viewerCanClose).toBe(false);
      await expectRefused(() => close(t.id, ADM), 400);
      await expectRefused(() => tickets.update(t.id, { status: TicketStatus.OPEN }, ADM, actor(ADM)), 400);
    });
  });

  describe('employee / intern close (product decision 1)', () => {
    it('an employee closes their own OPEN self-created TASK', async () => {
      const t = await newTicket({ createdById: E, assignedToId: E });
      expect((await tickets.findOne(t.id, actor(E))).viewerCanClose).toBe(true);
      await close(t.id, E);
      expect(await ticketRow(t.id)).toMatchObject({ status: 'CLOSED' });
      expect(await statusHistory(t.id)).toHaveLength(1);
    });

    it('closing their own IN_PROGRESS TASK stops the running timer in the same transaction', async () => {
      const t = await inProgress({ createdById: E, assignedToId: E });
      expect(await activeFor(E)).toHaveLength(1);
      await close(t.id, E);
      expect(await ticketRow(t.id)).toMatchObject({ status: 'CLOSED' });
      expect(await activeFor(E)).toHaveLength(0);
      const logs = await prisma.ticketTimeLog.findMany({ where: { ticketId: t.id } });
      expect(logs.every((l) => l.endedAt)).toBe(true);
      expect((await tickets.findOne(t.id, actor(E))).timers.activeClock).toBe('NONE');
      expect(await auditClean()).toBe('CLEAN');
    });

    it('an intern closes their own OPEN self-created TASK', async () => {
      const t = await newTicket({ createdById: I, assignedToId: I });
      await close(t.id, I);
      expect((await ticketRow(t.id))!.status).toBe('CLOSED');
    });

    it.each([
      ['own ticket in REVIEW', async () => inReview({ createdById: E, assignedToId: E }), 403],
      ['own ticket DONE', async () => newTicket({ createdById: E, assignedToId: E, status: 'DONE' }), 403],
      ['own QUERY', async () => newTicket({ createdById: E, assignedToId: E, type: 'QUERY' }), 403],
      ['own HELP', async () => newTicket({ createdById: E, assignedToId: E, type: 'HELP' }), 403],
      ['created by the manager, assigned to E', async () => newTicket({ createdById: MGR, assignedToId: E }), 403],
      ['created by E, primary assignee E2', async () => newTicket({ createdById: E, assignedToId: E2 }), 403],
      ['another employee\'s own ticket', async () => newTicket({ createdById: E2, assignedToId: E2 }), 403],
    ] as Array<[string, () => Promise<any>, number]>)('refused: %s', async (_label, make, status) => {
      const t = await make();
      const viewer = await tickets.findOne(t.id, actor(E)).catch(() => null);
      if (viewer) expect(viewer.viewerCanClose).toBe(false);
      await expectRefused(() => close(t.id, E), status);
    });
  });

  // ── B. Task-creation approvals ────────────────────────────────────────────

  describe('pending task-creation approvals', () => {
    async function pendingRequest() {
      return newTicket({
        createdById: E, assignedToId: E2, status: 'PENDING_APPROVAL', approvalState: 'PENDING',
        approvalType: 'TASK_CREATION', approverId: TL, approvalRequestedAt: now(),
      });
    }

    it('a direct Close (or any status change) of PENDING_APPROVAL is refused for everyone, even an admin', async () => {
      const t = await pendingRequest();
      for (const who of [ADM, MGR, TL]) {
        expect((await tickets.findOne(t.id, actor(who))).viewerCanClose).toBe(false);
        await expectRefused(() => close(t.id, who), 409, 'APPROVAL_DECISION_REQUIRED');
      }
      await expectRefused(() => tickets.update(t.id, { status: TicketStatus.OPEN }, ADM, actor(ADM)), 409, 'APPROVAL_DECISION_REQUIRED');
      expect((await tickets.getPendingApprovals(TL)).map((x: any) => x.id)).toEqual([t.id]);
    });

    it('only the approver sees it; Approve and Reject remove it from the queue', async () => {
      const a = await pendingRequest();
      const b = await pendingRequest();
      expect(await tickets.getPendingApprovals(MGR)).toEqual([]);
      expect((await tickets.getPendingApprovals(TL)).map((x: any) => x.id).sort()).toEqual([a.id, b.id].sort());
      await expectRefused(() => tickets.processApproval(a.id, { action: 'APPROVE' }, actor(MGR)), 403);

      await tickets.processApproval(a.id, { action: 'APPROVE' }, actor(TL));
      await tickets.processApproval(b.id, { action: 'REJECT', reason: 'Not needed' }, actor(TL));
      expect(await tickets.getPendingApprovals(TL)).toEqual([]);
      expect(await ticketRow(a.id)).toMatchObject({ status: 'OPEN', approvalState: 'APPROVED' });
      expect(await ticketRow(b.id)).toMatchObject({ status: 'CLOSED', approvalState: 'REJECTED' });
    });

    it('a legacy inconsistent row (CLOSED but still approvalState PENDING) is not offered as actionable', async () => {
      await newTicket({
        createdById: E, assignedToId: E2, status: 'CLOSED', approvalState: 'PENDING',
        approvalType: 'TASK_CREATION', approverId: TL, approvalRequestedAt: now(),
      });
      expect(await tickets.getPendingApprovals(TL)).toEqual([]);
    });
  });

  // ── E. Close from REVIEW, reminders, concurrency ──────────────────────────

  describe('closing a ticket in review', () => {
    async function reviewNotification(userId: string, ticketId: string, title: string) {
      return prisma.notification.create({
        data: { userId, title, message: 'awaiting your review', isRead: false, entityId: ticketId, entityType: 'TICKET', link: `/tickets/${ticketId}` },
      });
    }

    it('stops the reviewer clock, cancels the open cycle and resolves review reminders in the same transaction', async () => {
      const t = await inReview();
      await tickets.startReview(t.id, TL, actor(TL));
      advance(300);
      const reminder = await reviewNotification(TL, t.id, `Review needed: ${t.ticketId}`);
      const unrelated = await reviewNotification(TL, t.id, 'Ticket resolved: something else');

      await close(t.id, TL);

      expect((await ticketRow(t.id))!.status).toBe('CLOSED');
      expect(await activeFor(TL)).toHaveLength(0);
      const cycles = await prisma.reviewCycleLog.findMany({ where: { ticketId: t.id } });
      expect(cycles).toHaveLength(1);
      expect(cycles[0]).toMatchObject({ decision: 'CANCELLED' });
      expect(cycles[0].reviewerWorkSeconds).toBe(300);
      expect((await prisma.notification.findUnique({ where: { id: reminder.id } }))!.isRead).toBe(true);
      expect((await prisma.notification.findUnique({ where: { id: unrelated.id } }))!.isRead).toBe(false);
      expect(await auditClean()).toBe('CLEAN');
    });

    it('approve also resolves the review reminder; a rolled-back close leaves it unread', async () => {
      const t = await inReview();
      const reminder = await reviewNotification(TL, t.id, `Review needed: ${t.ticketId}`);

      // Forced failure on the ticket write: nothing commits, the reminder stays.
      interceptNextTransaction('ticket', 'update', async () => { throw new Error('forced ticket.update failure'); });
      await expect(close(t.id, TL)).rejects.toThrow('forced');
      expect((await prisma.notification.findUnique({ where: { id: reminder.id } }))!.isRead).toBe(false);
      expect((await ticketRow(t.id))!.status).toBe('REVIEW');

      await tickets.startReview(t.id, TL, actor(TL));
      await tickets.approve(t.id, TL, actor(TL), { taskEfficiencyRating: 5, employeePerformanceRating: 5, employeeAttitudeRating: 5 });
      expect((await prisma.notification.findUnique({ where: { id: reminder.id } }))!.isRead).toBe(true);
    });
  });

  describe('close concurrency (locked-row re-validation)', () => {
    it('two closes at once: exactly one commits, the other is refused with TICKET_ALREADY_CLOSED', async () => {
      const t = await inProgress();
      const gate = pauseNextTransactionAfter('ticket', 'update', 1);
      const first = close(t.id, TL);
      await gate.reached;
      const second = close(t.id, MGR).then(() => null, (e) => e);
      await waitUntilSomeoneWaitsForALock();
      gate.release();
      await first;
      const err = await second;
      expect(err?.getStatus()).toBe(409);
      expect(err.getResponse()).toMatchObject({ code: 'TICKET_ALREADY_CLOSED' });
      expect(await statusHistory(t.id)).toHaveLength(2); // IN_PROGRESS, then one CLOSED
      expect(await activeFor(E)).toHaveLength(0);
      expect(await auditClean()).toBe('CLEAN');
    });

    it('a close prepared while the ticket was IN_PROGRESS is refused once a submission to REVIEW commits first', async () => {
      const t = await inProgress();
      const gate = pauseNextTransactionAfter('ticket', 'update', 1);
      const submit = tickets.submitForReview(t.id, actor(E), undefined, {
        store: async () => 'test-store://none', discard: async () => undefined,
      });
      await gate.reached;
      const closing = close(t.id, TL).then(() => null, (e) => e);
      await waitUntilSomeoneWaitsForALock();
      gate.release();
      await submit;
      const err = await closing;
      expect(err?.getStatus()).toBe(409);
      expect(err.getResponse()).toMatchObject({ code: 'TICKET_CHANGED' });
      expect((await ticketRow(t.id))!.status).toBe('REVIEW');
      const cycles = await prisma.reviewCycleLog.findMany({ where: { ticketId: t.id } });
      expect(cycles).toHaveLength(1);
      expect(cycles[0].decision).toBeNull();
      // Retrying re-runs every rule against the current (REVIEW) row.
      await close(t.id, TL);
      expect((await ticketRow(t.id))!.status).toBe('CLOSED');
    });
  });

  // ── G. Type lock ──────────────────────────────────────────────────────────

  it('a ticket keeps the type it was created with; re-sending the same type is accepted', async () => {
    const t = await newTicket();
    await expectRefused(() => tickets.update(t.id, { type: 'QUERY' }, MGR, actor(MGR)), 409, 'TICKET_TYPE_LOCKED');
    await expectRefused(() => tickets.update(t.id, { type: 'BUG', title: 'renamed' }, MGR, actor(MGR)), 409, 'TICKET_TYPE_LOCKED');
    await tickets.update(t.id, { type: 'TASK', title: 'renamed' }, MGR, actor(MGR));
    expect(await ticketRow(t.id)).toMatchObject({ type: 'TASK', title: 'renamed' });
  });

  // ── D. Recent ordering ────────────────────────────────────────────────────

  describe('recent ordering', () => {
    const order = async () => (await tickets.findAll({ limit: 50 }, actor(ADM))).tickets.map((t: any) => t.ticketId);

    it('newest first; edit, assignment and status change move a ticket up; reads, review clocks and comments do not', async () => {
      const base = Date.now() - 10 * 60_000;
      const at = (m: number) => new Date(base + m * 60_000);
      const a = await newTicket({ ticketId: 'TKT-A', createdAt: at(1), updatedAt: at(1), priority: 'URGENT' });
      const b = await newTicket({ ticketId: 'TKT-B', createdAt: at(2), updatedAt: at(2), priority: 'LOW' });
      const c = await newTicket({ ticketId: 'TKT-C', createdAt: at(3), updatedAt: at(3), priority: 'MEDIUM' });
      // A new LOW ticket is above an older URGENT one: recency, not priority.
      expect(await order()).toEqual(['TKT-C', 'TKT-B', 'TKT-A']);

      await tickets.update(a.id, { title: 'edited' }, MGR, actor(MGR));
      expect(await order()).toEqual(['TKT-A', 'TKT-C', 'TKT-B']);

      await tickets.update(b.id, { assignedToId: E2 }, MGR, actor(MGR));
      expect(await order()).toEqual(['TKT-B', 'TKT-A', 'TKT-C']);

      await tickets.update(c.id, { status: TicketStatus.IN_PROGRESS }, E, actor(E));
      expect(await order()).toEqual(['TKT-C', 'TKT-B', 'TKT-A']);

      // Not meaningful ticket changes: viewing, the active-timer read, the
      // work timer ticking, and adding a comment.
      await tickets.findOne(a.id, actor(MGR));
      await tickets.getActiveTimer(E);
      advance(900);
      await prisma.comment.create({ data: { ticketId: a.id, authorId: MGR, content: 'just a note' } });
      expect(await order()).toEqual(['TKT-C', 'TKT-B', 'TKT-A']);
    });

    it('ties are broken deterministically (createdAt, then id)', async () => {
      const same = new Date(Date.now() - 60_000);
      await newTicket({ id: 'cqc-tie-1', ticketId: 'TKT-T1', createdAt: same, updatedAt: same });
      await newTicket({ id: 'cqc-tie-2', ticketId: 'TKT-T2', createdAt: same, updatedAt: same });
      expect(await order()).toEqual(['TKT-T2', 'TKT-T1']);
      expect(await order()).toEqual(['TKT-T2', 'TKT-T1']);
    });
  });

  // ── L3. Workday auto-close never closes the ticket ────────────────────────

  it('a workday policy auto-stop pauses the ticket timer but the ticket stays IN_PROGRESS, and resumes at the next Start Work', async () => {
    const t = await inProgress();
    const session = await prisma.workSession.findFirst({ where: { userId: E, logoutAt: null }, orderBy: { createdAt: 'desc' } });
    advance(9 * 3600);
    await workday.finalizeWorkSessionWithPresence(session!.id, {
      effectiveEndAt: now(),
      terminalStatus: 'AUTO_CLOSED',
      closureReason: 'POLICY_AUTO_STOP',
      autoClosedAt: now(),
      eventSource: 'system',
      attendanceEventType: 'POLICY_AUTO_STOP',
      ticketPauseReason: 'POLICY_AUTO_STOP',
    } as any, 'LOGGED_OUT');

    expect((await ticketRow(t.id))!.status).toBe('IN_PROGRESS');
    expect(await activeFor(E)).toHaveLength(0);
    expect((await prisma.ticketTimeLog.findFirst({ where: { ticketId: t.id }, orderBy: { startedAt: 'desc' } }))!.pauseReason).toBe('POLICY_AUTO_STOP');

    advance(12 * 3600);
    await workday.startWork(E);
    expect((await ticketRow(t.id))!.status).toBe('IN_PROGRESS');
    expect((await activeFor(E))[0]).toMatchObject({ ticketId: t.id });
    expect(await auditClean()).toBe('CLEAN');
  });

  // ── P. Created-date filter (inclusive company days) ───────────────────────

  it('"Created from / to" are whole company days, both ends included', async () => {
    // 2026-10-05 in IST runs from 2026-10-04T18:30Z to 2026-10-05T18:29:59.999Z.
    await newTicket({ ticketId: 'TKT-D-BEFORE', createdAt: new Date('2026-10-04T18:29:59.999Z') });
    await newTicket({ ticketId: 'TKT-D-START', createdAt: new Date('2026-10-04T18:30:00.000Z') });
    await newTicket({ ticketId: 'TKT-D-END', createdAt: new Date('2026-10-05T18:29:59.000Z') });
    await newTicket({ ticketId: 'TKT-D-AFTER', createdAt: new Date('2026-10-05T18:30:00.000Z') });
    const ids = async (q: any) => (await tickets.findAll({ limit: 50, ...q }, actor(ADM))).tickets.map((t: any) => t.ticketId).sort();
    expect(await ids({ dateFrom: '2026-10-05', dateTo: '2026-10-05' })).toEqual(['TKT-D-END', 'TKT-D-START']);
    expect(await ids({ dateFrom: '2026-10-05' })).toEqual(['TKT-D-AFTER', 'TKT-D-END', 'TKT-D-START']);
    expect(await ids({ dateTo: '2026-10-04' })).toEqual(['TKT-D-BEFORE']);
    // Not a date: ignored, never a database error.
    expect(await ids({ dateFrom: 'not-a-date' })).toHaveLength(4);
    // Scope still applies with filters: an employee sees only their own.
    const mine = await tickets.findAll({ limit: 50, dateFrom: '2026-10-05' }, actor(E2));
    expect(mine.tickets).toEqual([]);
  });

  // ── A. Export ─────────────────────────────────────────────────────────────

  describe('export', () => {
    it('exports every scoped ticket past one page, with productive Elapsed Hours, company dates and formula-safe cells', async () => {
      const N = 520; // more than one export page (500)
      await prisma.ticket.createMany({
        data: Array.from({ length: N }, (_, i) => ({
          ticketId: `TKT-X-${i}`, title: `bulk ${i}`, category: 'IT', type: 'TASK',
          createdById: MGR, assignedToId: E, departmentId: D1,
          createdAt: new Date(Date.UTC(2026, 9, 4, 20, 0, 0) + i * 1000), // 05 Oct IST (early morning)
        })) as any,
      });
      const special = await newTicket({ ticketId: 'TKT-X-SPECIAL', title: '  =HYPERLINK("http://x")\nsecond line, "quoted"', estimatedMinutes: 90 });
      const sId = special.id;
      const t0 = new Date(nowMs - 4 * 3600_000);
      const end = (s: number) => new Date(t0.getTime() + s * 1000);
      await prisma.ticketTimeLog.createMany({
        data: [
          { ticketId: sId, userId: E, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', startedAt: t0, endedAt: end(3600), durationSeconds: 3600, countsAsWork: true },
          { ticketId: sId, userId: E, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', startedAt: end(3600), endedAt: end(10800), durationSeconds: 7200, countsAsWork: false, pauseReason: 'INTEGRITY_REPAIR' },
          { ticketId: sId, userId: TL, stage: 'REVIEW', ownerType: 'REVIEWER', source: 'SYSTEM', startedAt: end(10800), endedAt: end(12600), durationSeconds: 1800, countsAsWork: true },
        ] as any,
      });

      const csv = await tickets.exportCsv({}, actor(ADM));
      const lines = csv.split('\n');
      expect(lines).toHaveLength(1 + N + 1); // header + every ticket, no silent cap
      const header = lines[0].split(',');
      const row = lines.find((l) => l.startsWith('"TKT-X-SPECIAL"'))!;
      // Leading whitespace before "=" is neutralised; quotes doubled; line break flattened.
      expect(row).toContain(`"'  =HYPERLINK(""http://x"") second line, ""quoted"""`);
      const cells = row.match(/"(?:[^"]|"")*"/g)!.map((c) => c.slice(1, -1));
      expect(cells[header.indexOf('Estimated Hours')]).toBe('1.5');
      expect(cells[header.indexOf('Elapsed Hours')]).toBe('1'); // productive ASSIGNEE only
      const bulk = lines.find((l) => l.startsWith('"TKT-X-0"'))!.match(/"(?:[^"]|"")*"/g)!.map((c) => c.slice(1, -1));
      expect(bulk[header.indexOf('Created At')]).toBe('2026-10-05'); // 01:30 IST, not the UTC 04 Oct
      expect(new Set(lines.slice(1).map((l) => l.split(',')[0])).size).toBe(N + 1);
    });

    it('applies scope and filters; an empty result is a valid header-only file', async () => {
      await newTicket({ ticketId: 'TKT-S-MINE', createdById: E, assignedToId: E });
      await newTicket({ ticketId: 'TKT-S-OTHER', createdById: E2, assignedToId: E2 });
      const mine = (await tickets.exportCsv({}, actor(E))).split('\n');
      expect(mine.slice(1).map((l) => l.split(',')[0])).toEqual(['"TKT-S-MINE"']);
      const none = (await tickets.exportCsv({ search: 'no-such-ticket' }, actor(ADM))).split('\n');
      expect(none).toHaveLength(1);
      expect(none[0]).toContain('Ticket ID');
    });
  });

  // ── K. New Ticket planning default ────────────────────────────────────────

  it('creating a ticket with the planning default (Start = now) leaves it OPEN with no timer and no actualStartAt', async () => {
    const created: any = await tickets.create({
      title: 'Planned now', type: 'TASK', category: 'OPERATIONS', priority: 'MEDIUM', departmentId: D1,
      dueDate: new Date(nowMs + 8 * 3600_000).toISOString(),
      scheduledStartAt: new Date(nowMs).toISOString(),
    }, E, actor(E));
    const row = await ticketRow(created.id);
    expect(row).toMatchObject({ status: 'OPEN', actualStartAt: null, assignedToId: E });
    expect(row!.scheduledStartAt!.getTime()).toBe(nowMs);
    expect(await prisma.ticketTimeLog.count({ where: { ticketId: created.id } })).toBe(0);
    expect((await tickets.findOne(created.id, actor(E))).timers.activeClock).toBe('NONE');
  });
});
