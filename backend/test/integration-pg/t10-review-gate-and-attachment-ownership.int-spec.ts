/**
 * Review workspace follow-up against real PostgreSQL: the mandatory
 * review-start gate (decisions need the decider's running review), and
 * attachment ownership, review-cycle evidence and locking.
 *
 * Real: Prisma, PostgreSQL, row and advisory locks, the one-active-timed
 * index, the new attachment columns and foreign keys, TicketsService,
 * TicketLedgerService, WorkdayService, ActiveWorkdayPolicyService, and the
 * real permission services (TicketAccessService, AccessPolicyService,
 * HierarchyApprovalService) over real users, roles and departments. Doubled:
 * websocket gateway, notifications, event bus, operational event log (all
 * recorded), file storage (records store/discard), the SLA decorator.
 *
 * One mutable TVA clock drives every service, so durations are exact. The
 * race is coordinated with a transaction gate and pg_locks, never timed.
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
import { TicketsService, type IncomingAttachmentFile } from '../../src/modules/operations/tickets/tickets.service';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { UsersService } from '../../src/modules/core/users/users.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { oneActiveIndexState } from './one-active-index';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const D1 = 'd-t10-ops';
const MGR = 'u-t10-manager';
const TL = 'u-t10-lead';
const TL2 = 'u-t10-lead-2';
const E = 'u-t10-employee';
const E2 = 'u-t10-employee-2';
const ROLE_OF: Record<string, string> = { [MGR]: 'MANAGER', [TL]: 'TEAM_LEAD', [TL2]: 'TEAM_LEAD', [E]: 'EMPLOYEE', [E2]: 'EMPLOYEE' };
const actor = (id: string) => ({ id, role: { name: ROLE_OF[id] }, departmentId: D1 });

describe('T10 review-start gate and attachment ownership (PostgreSQL)', () => {
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

  let stored: string[] = [];
  let discarded: string[] = [];
  const storage = {
    store: jest.fn(async (ticketId: string, file: IncomingAttachmentFile) => {
      const url = `test-store://${ticketId}/${stored.length + 1}/${file.originalname}`;
      stored.push(url);
      return url;
    }),
    discard: jest.fn(async (url: string) => { discarded.push(url); }),
  };
  const file = (name = 'proof.pdf', mimetype = 'application/pdf'): IncomingAttachmentFile =>
    ({ originalname: name, mimetype, size: 1234, buffer: Buffer.from(`content of ${name}`) });

  // ── Clock and coordination ────────────────────────────────────────────────

  const advance = (seconds: number) => { nowMs += seconds * 1000; };
  const now = () => new Date(nowMs);

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

  function failNextTransactionOn(model: string, op: string) {
    interceptNextTransaction(model, op, async () => { throw new Error(`forced ${model}.${op} failure`); });
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
  const cyclesOf = (ticketId: string) => prisma.reviewCycleLog.findMany({ where: { ticketId }, orderBy: { cycleNo: 'asc' } });
  const attachmentsOf = (ticketId: string) => prisma.attachment.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });
  const auditClean = async () => (await runReadOnlyAudit(prisma as any, { now: now(), staleHours: 12, sampleLimit: 5 })).result;

  async function snapshot() {
    const out: Record<string, string> = {};
    for (const table of ['tickets', 'ticket_time_logs', 'ticket_history', 'activity_logs', 'review_cycle_logs', 'comments', 'attachments']) {
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
    expect(JSON.stringify(err.getResponse())).not.toMatch(/prisma|ticket_time_logs|attachments_|constraint|P20\d\d/i);
    expect(await snapshot()).toEqual(before);
    expect(effects.gateway.emitTicketStatusChanged).not.toHaveBeenCalled();
    expect(effects.eventLog.log).not.toHaveBeenCalled();
    return err;
  }

  async function seed() {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma.department.create({ data: { id: D1, name: 'T10 Operations' } as any });
    await prisma.role.createMany({
      data: [
        { id: 'r-t10-manager', name: 'MANAGER', level: 2 },
        { id: 'r-t10-lead', name: 'TEAM_LEAD', level: 3 },
        { id: 'r-t10-employee', name: 'EMPLOYEE', level: 4 },
      ] as any,
    });
    const roleId: Record<string, string> = { MANAGER: 'r-t10-manager', TEAM_LEAD: 'r-t10-lead', EMPLOYEE: 'r-t10-employee' };
    for (const id of [MGR, TL, TL2, E, E2]) {
      await prisma.user.create({
        data: {
          id, roleId: roleId[ROLE_OF[id]], name: id, departmentId: D1,
          email: `${id}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE',
        } as any,
      });
    }
  }

  async function newTicket(fields: Record<string, any> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        ticketId: `TKT-T10-${seq}`, title: `Evidence fixture ${seq}`, category: 'IT', type: 'TASK',
        createdById: MGR, assignedToId: E, departmentId: D1, estimatedMinutes: 120, ...fields,
      } as any,
    });
  }

  /** E is working on a ticket: IN_PROGRESS, E's timer running. */
  async function inProgress(fields: Record<string, any> = {}) {
    const t = await newTicket(fields);
    await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, E, actor(E));
    advance(600);
    return t;
  }

  /** E submitted with no proof (Skip for now). */
  async function inReview(fields: Record<string, any> = {}) {
    const t = await inProgress(fields);
    await tickets.submitForReview(t.id, actor(E), undefined, storage);
    advance(60);
    resetEffects();
    return t;
  }

  /** TL timing their own ticket (TL is its creator's assignee here). */
  async function leadOwnWork() {
    const own = await newTicket({ createdById: MGR, assignedToId: TL });
    await tickets.update(own.id, { status: TicketStatus.IN_PROGRESS }, TL, actor(TL));
    advance(300);
    return own;
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
    const hierarchy = new HierarchyApprovalService(prisma);
    const access = new TicketAccessService(prisma, new AccessPolicyService(prisma), hierarchy);
    tickets = new TicketsService(
      prisma, effects.gateway as any, effects.notifications as any, { get: () => undefined } as any,
      effects.bus as any, effects.eventLog as any, access, hierarchy,
      { getSlaConfig: async () => ({ review: { LOW: 48, MEDIUM: 24, HIGH: 8, URGENT: 4 } }), decorateTicket: async (t: any) => t } as any,
      ledger, {} as any, new ActiveWorkdayPolicyService(tva), tva,
    );
    expect(await oneActiveIndexState(prisma)).toMatchObject({ exists: true, valid: true });
  });

  beforeEach(async () => {
    jest.spyOn(tva, 'now').mockImplementation(() => new Date(nowMs));
    nowMs = Math.floor(Date.now() / 1000) * 1000;
    await seed();
    for (const id of [E, TL, TL2, MGR]) await workday.startWork(id);
    stored = [];
    discarded = [];
    storage.store.mockClear();
    storage.discard.mockClear();
    resetEffects();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  // ── Review-start gate ─────────────────────────────────────────────────────

  it('G1. opening a ticket in review (and reading the active timer) changes nothing', async () => {
    const t = await inReview();
    const own = await leadOwnWork();
    const before = await snapshot();
    resetEffects();

    const seen = await tickets.findOne(t.id, actor(TL));
    const timer = await tickets.getActiveTimer(TL);

    expect(await snapshot()).toEqual(before);
    expect(effects.eventLog.log).not.toHaveBeenCalled();
    expect(seen).toMatchObject({ viewerCanApprove: true, reviewTimerRequired: true, timers: { activeClock: 'NONE' } });
    expect(seen.currentReviewCycle).toMatchObject({ cycleNo: 1 });
    // The prompt can name the employee ticket a start would pause.
    expect(timer).toMatchObject({ activeClock: 'EMPLOYEE_WORK', active: { ownerType: 'ASSIGNEE', ticket: { id: own.id, ticketId: own.ticketId } } });
  });

  it('G2. Approve, Send Back and a direct status send-back are refused until the reviewer starts the review', async () => {
    const t = await inReview();
    await expectRefused(() => tickets.approve(t.id, TL, actor(TL), { taskEfficiencyRating: 5, employeePerformanceRating: 5, employeeAttitudeRating: 5 }), 409, 'REVIEW_NOT_STARTED');
    await expectRefused(() => tickets.reject(t.id, 'needs work', TL, actor(TL)), 409, 'REVIEW_NOT_STARTED');
    await expectRefused(() => tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, TL, actor(TL)), 409, 'REVIEW_NOT_STARTED');
    // Another reviewer's running review does not count as the decider's.
    await tickets.startReview(t.id, TL, actor(TL));
    await expectRefused(() => tickets.reject(t.id, 'not mine', TL2, actor(TL2)), 409, 'REVIEW_CLAIMED');
  });

  it('G3. Start Review pauses the running employee ticket and starts review at the same instant (one active timed row)', async () => {
    const own = await leadOwnWork();
    const t = await inReview();
    await tickets.startReview(t.id, TL, actor(TL));

    const ownRows = await prisma.ticketTimeLog.findMany({ where: { ticketId: own.id, userId: TL }, orderBy: { startedAt: 'asc' } });
    const review = await prisma.ticketTimeLog.findFirst({ where: { ticketId: t.id, userId: TL, ownerType: 'REVIEWER' } });
    expect(ownRows.at(-1)).toMatchObject({ pauseReason: 'REVIEW_SWITCHED' });
    expect(ownRows.at(-1)!.endedAt!.getTime()).toBe(review!.startedAt.getTime());
    expect(await activeFor(TL)).toHaveLength(1);
    expect(await tickets.getActiveTimer(TL)).toMatchObject({ activeClock: 'REVIEWER_WORK', active: { ticket: { id: t.id } } });
    expect(await auditClean()).toBe('CLEAN');
  });

  it('G4. Approve after starting resumes the switched employee ticket', async () => {
    const own = await leadOwnWork();
    const t = await inReview();
    await tickets.startReview(t.id, TL, actor(TL));
    advance(420);
    await tickets.approve(t.id, TL, actor(TL), { taskEfficiencyRating: 5, employeePerformanceRating: 4, employeeAttitudeRating: 5 });

    expect((await ticketRow(t.id))!.status).toBe('DONE');
    expect((await cyclesOf(t.id))[0]).toMatchObject({ decision: 'APPROVED', reviewerId: TL, reviewerWorkSeconds: 420 });
    const active = await activeFor(TL);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ ticketId: own.id, ownerType: 'ASSIGNEE' });
    expect(await auditClean()).toBe('CLEAN');
  });

  it('G5. Send Back after starting resumes the switched employee ticket and opens rework for the worker', async () => {
    const own = await leadOwnWork();
    const t = await inReview();
    await tickets.startReview(t.id, TL, actor(TL));
    advance(120);
    await tickets.reject(t.id, 'fix the totals', TL, actor(TL));

    expect((await ticketRow(t.id))!.status).toBe('IN_PROGRESS');
    expect((await cyclesOf(t.id))[0]).toMatchObject({ decision: 'REWORK', reviewerWorkSeconds: 120 });
    expect((await activeFor(TL))[0]).toMatchObject({ ticketId: own.id, ownerType: 'ASSIGNEE' });
    expect(await auditClean()).toBe('CLEAN');
  });

  it('G6. an accidental review is paused: nothing is decided and the previous ticket resumes', async () => {
    const own = await leadOwnWork();
    const t = await inReview();
    await tickets.startReview(t.id, TL, actor(TL));
    advance(30);
    await tickets.pauseReview(t.id, TL, actor(TL));

    expect((await ticketRow(t.id))!.status).toBe('REVIEW');
    expect((await cyclesOf(t.id))[0]).toMatchObject({ decision: null });
    expect((await activeFor(TL))[0]).toMatchObject({ ticketId: own.id, ownerType: 'ASSIGNEE' });
    // Decisions are refused again until the review is restarted.
    await expectRefused(() => tickets.reject(t.id, 'x', TL, actor(TL)), 409, 'REVIEW_NOT_STARTED');
  });

  it('G7. a reviewer on break has no running review, so cannot decide; nothing resumes on break', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, TL, actor(TL));
    await workday.startBreak(TL, { breakType: 'TEA' });
    expect(await activeFor(TL)).toHaveLength(0);
    // Completing on break is refused by the existing workday guard first.
    const before = await snapshot();
    await expect(tickets.approve(t.id, TL, actor(TL), { taskEfficiencyRating: 5, employeePerformanceRating: 5, employeeAttitudeRating: 5 }))
      .rejects.toThrow('Resume work before submitting or completing a ticket.');
    expect(await snapshot()).toEqual(before);
    // Sending back has no such guard: the stopped review is what refuses it.
    await expectRefused(() => tickets.reject(t.id, 'x', TL, actor(TL)), 409, 'REVIEW_NOT_STARTED');
  });

  it('G8. QUERY decisions keep their own rule: no review timer is required', async () => {
    const t = await inReview({ type: 'QUERY', createdById: TL, assignedToId: E });
    const seen = await tickets.findOne(t.id, actor(TL));
    expect(seen.reviewTimerRequired).toBe(false);
    await tickets.approve(t.id, TL, actor(TL), { taskEfficiencyRating: 5, employeePerformanceRating: 5, employeeAttitudeRating: 5 });
    expect((await ticketRow(t.id))!.status).toBe('DONE');
  });

  // ── Optional proof and atomic submission ──────────────────────────────────

  it('A1. submitting without an attachment ("Skip for now") works and stores nothing', async () => {
    const t = await inProgress();
    await tickets.submitForReview(t.id, actor(E), undefined, storage);
    expect((await ticketRow(t.id))!.status).toBe('REVIEW');
    expect(await cyclesOf(t.id)).toHaveLength(1);
    expect(await attachmentsOf(t.id)).toHaveLength(0);
    expect(storage.store).not.toHaveBeenCalled();
    const seen = await tickets.findOne(t.id, actor(TL));
    expect(seen.attachments).toEqual([]);
  });

  it('A2. submitting with proof: one POC row, owned by the submitter, bound to cycle 1 and locked, in the same commit', async () => {
    const t = await inProgress();
    await tickets.submitForReview(t.id, actor(E), file(), storage);
    const [cycle] = await cyclesOf(t.id);
    const rows = await attachmentsOf(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      uploadedById: E, purpose: 'POC', isPoc: true, reviewCycleId: cycle.id,
      lockReason: 'SUBMITTED_FOR_REVIEW', url: stored[0],
    });
    expect(rows[0].lockedAt!.getTime()).toBe((await ticketRow(t.id))!.submittedAt!.getTime());
    expect(discarded).toEqual([]);
    expect(effects.eventLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ATTACHMENT_UPLOADED', actorId: E, metadata: expect.objectContaining({ purpose: 'POC', reviewCycleId: cycle.id }),
    }));
    // The reviewer sees it as current evidence, and cannot delete it.
    const seen = await tickets.findOne(t.id, actor(TL));
    expect(seen.currentReviewCycle).toEqual({ id: cycle.id, cycleNo: 1 });
    expect(seen.attachments[0]).toMatchObject({ purpose: 'POC', locked: true, canDelete: false, cycleNo: 1, uploadedBy: { id: E } });
    expect(seen.attachments[0].url).toBeUndefined();
  });

  it('A3. a submission that fails after storing the proof leaves no ticket change, no row, and discards the file', async () => {
    const t = await inProgress();
    const before = await snapshot();
    failNextTransactionOn('attachment', 'create');
    await expect(tickets.submitForReview(t.id, actor(E), file(), storage)).rejects.toThrow(/forced attachment.create failure/);
    expect(await snapshot()).toEqual(before);
    expect(stored).toHaveLength(1);
    expect(discarded).toEqual(stored);
  });

  it('A4. a refused submission never stores the file', async () => {
    const t = await inProgress();
    await workday.startBreak(E, { breakType: 'TEA' });
    await expect(tickets.submitForReview(t.id, actor(E), file(), storage)).rejects.toThrow(/Resume work/);
    expect(storage.store).not.toHaveBeenCalled();
    expect(await attachmentsOf(t.id)).toHaveLength(0);
  });

  it('A5. proof uploaded before submitting is pending (unlocked, deletable by its uploader) and binds to the cycle on submission', async () => {
    const t = await inProgress();
    const pending = await tickets.uploadAttachment(t.id, file('draft.png', 'image/png'), { purpose: 'POC' }, actor(E), storage);
    expect(pending).toMatchObject({ purpose: 'POC', locked: false, canDelete: true, reviewCycleId: null });

    // The older two-request path (upload, then a plain status change) binds it too.
    await tickets.update(t.id, { status: TicketStatus.REVIEW }, E, actor(E));
    const [cycle] = await cyclesOf(t.id);
    const [row] = await attachmentsOf(t.id);
    expect(row).toMatchObject({ reviewCycleId: cycle.id, lockReason: 'SUBMITTED_FOR_REVIEW' });
    expect(row.lockedAt).not.toBeNull();
    await expectRefused(() => tickets.deleteAttachment(t.id, row.id, actor(E)), 409, 'ATTACHMENT_LOCKED');
  });

  // ── Ownership ─────────────────────────────────────────────────────────────

  it('O1. a TL reference file: the assignee can view it but not delete it', async () => {
    const t = await inProgress();
    const ref = await tickets.uploadAttachment(t.id, file('spec.docx', 'application/msword'), { purpose: 'REFERENCE' }, actor(TL), storage);
    expect(ref).toMatchObject({ purpose: 'REFERENCE', uploadedBy: { id: TL } });
    expect((await tickets.findOne(t.id, actor(E))).attachments[0]).toMatchObject({ id: ref.id, canDelete: false });
    expect(await tickets.getAttachmentForDownload(t.id, ref.id, actor(E))).toMatchObject({ id: ref.id });
    await expectRefused(() => tickets.deleteAttachment(t.id, ref.id, actor(E)), 403, 'ATTACHMENT_NOT_OWNER');
  });

  it('O2. an employee file: TL, manager and reviewer can view it but none can delete it', async () => {
    const t = await inProgress();
    const mine = await tickets.uploadAttachment(t.id, file('notes.txt', 'text/plain'), {}, actor(E), storage);
    for (const who of [TL, MGR, TL2]) {
      expect((await tickets.findOne(t.id, actor(who))).attachments[0]).toMatchObject({ id: mine.id, canDelete: false });
      await expectRefused(() => tickets.deleteAttachment(t.id, mine.id, actor(who)), 403, 'ATTACHMENT_NOT_OWNER');
    }
  });

  it('O3. reviewer feedback: the employee cannot delete it; the reviewer can until the decision, then it is locked', async () => {
    const t = await inReview();
    await tickets.startReview(t.id, TL, actor(TL));
    const fb1 = await tickets.uploadAttachment(t.id, file('markup-1.png', 'image/png'), { purpose: 'REVIEW_FEEDBACK' }, actor(TL), storage);
    const fb2 = await tickets.uploadAttachment(t.id, file('markup-2.png', 'image/png'), { purpose: 'REVIEW_FEEDBACK' }, actor(TL), storage);
    const [cycle] = await cyclesOf(t.id);
    expect(fb1).toMatchObject({ purpose: 'REVIEW_FEEDBACK', reviewCycleId: cycle.id, locked: false, canDelete: true });
    await expectRefused(() => tickets.deleteAttachment(t.id, fb1.id, actor(E)), 403, 'ATTACHMENT_NOT_OWNER');

    await tickets.deleteAttachment(t.id, fb2.id, actor(TL));
    expect(effects.eventLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ATTACHMENT_DELETED', actorId: TL }));

    await tickets.reject(t.id, 'see markup', TL, actor(TL));
    const [row] = await attachmentsOf(t.id);
    expect(row).toMatchObject({ id: fb1.id, lockReason: 'REVIEW_REWORK' });
    await expectRefused(() => tickets.deleteAttachment(t.id, fb1.id, actor(TL)), 409, 'ATTACHMENT_LOCKED');
  });

  it('O4. the uploader deletes their own unlocked file; the event records the authenticated actor', async () => {
    const t = await inProgress();
    const mine = await tickets.uploadAttachment(t.id, file('scratch.csv', 'text/csv'), { uploadedById: TL }, actor(E), storage);
    // A client-supplied uploader is ignored: ownership is the authenticated user.
    expect((await prisma.attachment.findUnique({ where: { id: mine.id } }))!.uploadedById).toBe(E);
    resetEffects();
    await tickets.deleteAttachment(t.id, mine.id, actor(E));
    expect(await attachmentsOf(t.id)).toHaveLength(0);
    expect(effects.eventLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ATTACHMENT_DELETED', actorId: E, metadata: expect.objectContaining({ attachmentId: mine.id }),
    }));
  });

  it('O5. purposes cannot be claimed by the wrong person', async () => {
    const t = await inProgress();
    // Only the ticket's workers add proof; only a reviewer adds review feedback, only in review.
    await expectRefused(() => tickets.uploadAttachment(t.id, file(), { purpose: 'POC' }, actor(TL), storage), 403, 'POC_NOT_ALLOWED');
    await expectRefused(() => tickets.uploadAttachment(t.id, file(), { purpose: 'REVIEW_FEEDBACK' }, actor(TL), storage), 403, 'REVIEW_FEEDBACK_NOT_ALLOWED');
    await expectRefused(() => tickets.uploadAttachment(t.id, file(), { purpose: 'OWNER_OVERRIDE' }, actor(E), storage), 400, 'ATTACHMENT_PURPOSE_INVALID');
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('O6. a legacy attachment (uploader unknown) is viewable but never deletable, and never bound to a cycle', async () => {
    const t = await inProgress();
    const legacy = await prisma.attachment.create({
      data: { ticketId: t.id, filename: 'old-proof.pdf', url: 'legacy://x', isPoc: true, pocFor: t.id, purpose: 'POC' } as any,
    });
    const seen = (await tickets.findOne(t.id, actor(E))).attachments[0];
    expect(seen).toMatchObject({ legacyProtected: true, canDelete: false, uploadedBy: null });
    await expectRefused(() => tickets.deleteAttachment(t.id, legacy.id, actor(E)), 403, 'ATTACHMENT_LEGACY_PROTECTED');
    await expectRefused(() => tickets.deleteAttachment(t.id, legacy.id, actor(MGR)), 403, 'ATTACHMENT_LEGACY_PROTECTED');

    await tickets.submitForReview(t.id, actor(E), undefined, storage);
    expect(await prisma.attachment.findUnique({ where: { id: legacy.id } })).toMatchObject({ reviewCycleId: null, lockedAt: null });
  });

  it('O7. deleting a user who uploaded evidence is refused by the database; the evidence stays', async () => {
    const t = await inProgress();
    await tickets.submitForReview(t.id, actor(E), file(), storage);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = '${E}'`)).rejects.toThrow(/attachments_uploadedById_fkey|foreign key/i);
    expect(await attachmentsOf(t.id)).toHaveLength(1);
  });

  // ── Locking across the review lifecycle; evidence per cycle ───────────────

  it('L1. evidence stays with its cycle across rework, withdrawal and approval, and is never deletable afterwards', async () => {
    const t = await inProgress();
    await tickets.submitForReview(t.id, actor(E), file('v1.pdf'), storage);              // cycle 1
    await tickets.startReview(t.id, TL, actor(TL));
    await tickets.reject(t.id, 'redo section 2', TL, actor(TL));                         // REWORK
    advance(300);
    await tickets.submitForReview(t.id, actor(E), file('v2.pdf'), storage);              // cycle 2
    await tickets.withdraw(t.id, E, actor(E), 'forgot a page');                          // WITHDRAWN
    advance(300);
    await tickets.submitForReview(t.id, actor(E), file('v3.pdf'), storage);              // cycle 3
    await tickets.startReview(t.id, TL, actor(TL));
    await tickets.approve(t.id, TL, actor(TL), { taskEfficiencyRating: 5, employeePerformanceRating: 5, employeeAttitudeRating: 5 });

    const cycles = await cyclesOf(t.id);
    expect(cycles.map((c) => c.decision)).toEqual(['REWORK', 'WITHDRAWN', 'APPROVED']);
    const rows = await attachmentsOf(t.id);
    expect(rows.map((r) => [r.filename, r.reviewCycleId])).toEqual([
      ['v1.pdf', cycles[0].id], ['v2.pdf', cycles[1].id], ['v3.pdf', cycles[2].id],
    ]);
    expect(rows.every((r) => r.lockedAt !== null && r.uploadedById === E)).toBe(true);
    for (const r of rows) {
      await expectRefused(() => tickets.deleteAttachment(t.id, r.id, actor(E)), 409, 'ATTACHMENT_LOCKED');
    }
    expect(await auditClean()).toBe('CLEAN');
  });

  it('L2. while cycle 2 is in review, only cycle 2 proof is current; cycle 1 proof is previous evidence', async () => {
    const t = await inProgress();
    await tickets.submitForReview(t.id, actor(E), file('first.pdf'), storage);
    await tickets.startReview(t.id, TL, actor(TL));
    await tickets.reject(t.id, 'again', TL, actor(TL));
    advance(120);
    await tickets.submitForReview(t.id, actor(E), file('second.pdf'), storage);

    const seen = await tickets.findOne(t.id, actor(TL));
    expect(seen.currentReviewCycle).toMatchObject({ cycleNo: 2 });
    const byName = Object.fromEntries(seen.attachments.map((a: any) => [a.filename, a]));
    expect(byName['second.pdf']).toMatchObject({ reviewCycleId: seen.currentReviewCycle.id, cycleNo: 2 });
    expect(byName['first.pdf']).toMatchObject({ cycleNo: 1 });
    expect(byName['first.pdf'].reviewCycleId).not.toBe(seen.currentReviewCycle.id);
  });

  it('L3. proof added while in review is bound to the open cycle and locked at once', async () => {
    const t = await inReview();
    const late = await tickets.uploadAttachment(t.id, file('addendum.pdf'), { purpose: 'POC' }, actor(E), storage);
    const [cycle] = await cyclesOf(t.id);
    expect(late).toMatchObject({ reviewCycleId: cycle.id, locked: true, lockReason: 'SUBMITTED_FOR_REVIEW', canDelete: false });
  });

  it('R1. a delete racing the submission that locks the same proof waits for it and is then refused (409), never half-done', async () => {
    const t = await inProgress();
    const pending = await tickets.uploadAttachment(t.id, file('race.pdf'), { purpose: 'POC' }, actor(E), storage);

    const pause = pauseNextTransactionAfter('attachment', 'updateMany', 1);
    const submission = tickets.update(t.id, { status: TicketStatus.REVIEW }, E, actor(E));
    await pause.reached;
    const deletion = tickets.deleteAttachment(t.id, pending.id, actor(E)).then(() => null, (e) => e);
    await waitUntilSomeoneWaitsForALock();
    pause.release();
    await submission;
    const err: any = await deletion;
    expect(err?.getStatus?.()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'ATTACHMENT_LOCKED' });
    expect(await prisma.attachment.findUnique({ where: { id: pending.id } })).toMatchObject({ lockReason: 'SUBMITTED_FOR_REVIEW' });
  });

  // ── The existing guarded permanent delete: attachment uploaders are blocked ─

  /** UsersService as the app builds it; its event log is the recorded double. */
  const usersService = () => new UsersService(prisma, new AccessPolicyService(prisma), effects.eventLog as any, {} as any, {} as any);
  const deletionLogged = () => effects.eventLog.log.mock.calls.some(([e]: any[]) => e?.action === 'USER_PERMANENTLY_DELETED');

  async function inactiveUser(id: string) {
    return prisma.user.create({
      data: {
        id, roleId: 'r-t10-employee', name: id, departmentId: D1, isActive: false,
        email: `${id}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE',
      } as any,
    });
  }

  it('U1. a user who uploaded an attachment cannot be permanently deleted: the blocker is named and counted, nothing changes', async () => {
    const t = await newTicket();
    await inactiveUser('u-t10-uploader');
    const att = await prisma.attachment.create({
      data: { ticketId: t.id, filename: 'kept.pdf', url: 'test-store://kept', uploadedById: 'u-t10-uploader', purpose: 'REFERENCE' } as any,
    });
    const before = await snapshot();
    resetEffects();

    const err: any = await usersService().permanentDelete('u-t10-uploader', MGR).then(() => null, (e) => e);
    expect(err?.getStatus?.()).toBe(409);
    expect(err.getResponse()).toMatchObject({
      message: 'Cannot permanently delete user with linked records.',
      blockers: { 'Ticket Attachments Uploaded': 1 },
    });
    expect(Object.keys(err.getResponse().blockers)).toEqual(['Ticket Attachments Uploaded']); // the attachment alone blocks
    expect(await snapshot()).toEqual(before);
    expect(await prisma.user.findUnique({ where: { id: 'u-t10-uploader' } })).not.toBeNull();
    expect(await prisma.attachment.findUnique({ where: { id: att.id } })).toEqual(att); // uploader and row unchanged
    expect(deletionLogged()).toBe(false);
  });

  it('U2. locked review evidence keeps its uploader and lock when that uploader\'s deletion is refused', async () => {
    const t = await inProgress();
    await tickets.submitForReview(t.id, actor(E), file('evidence.pdf'), storage);
    const [proof] = await attachmentsOf(t.id);
    await prisma.user.update({ where: { id: E }, data: { isActive: false } });
    resetEffects();

    const err: any = await usersService().permanentDelete(E, MGR).then(() => null, (e) => e);
    expect(err?.getStatus?.()).toBe(409);
    expect(err.getResponse().blockers).toMatchObject({ 'Ticket Attachments Uploaded': 1 });
    expect(await prisma.attachment.findUnique({ where: { id: proof.id } })).toEqual(proof);
    expect(proof).toMatchObject({ uploadedById: E, lockReason: 'SUBMITTED_FOR_REVIEW' });
    expect(deletionLogged()).toBe(false);
  });

  it('U3. a user with no linked records is still permanently deleted, as before', async () => {
    await inactiveUser('u-t10-unused');
    resetEffects();
    await expect(usersService().permanentDelete('u-t10-unused', MGR)).resolves.toEqual({ message: 'User permanently deleted' });
    expect(await prisma.user.findUnique({ where: { id: 'u-t10-unused' } })).toBeNull();
    expect(deletionLogged()).toBe(true);
    // Active users and self-deletion are still refused.
    await inactiveUser('u-t10-unused-2');
    await prisma.user.update({ where: { id: 'u-t10-unused-2' }, data: { isActive: true } });
    await expect(usersService().permanentDelete('u-t10-unused-2', MGR)).rejects.toThrow('Deactivate user before permanent deletion');
    await expect(usersService().permanentDelete(MGR, MGR)).rejects.toThrow('Cannot permanently delete your own account');
  });

  it('S1. self-assigned work is still approved comment-only by the hierarchy (no ratings stored)', async () => {
    // The self-assigned classification is forced so approve() applies its
    // rating rule here; resolving the reporting hierarchy itself is covered
    // by the unit suites (tickets.hierarchy-approval).
    const t = await inReview();
    await tickets.startReview(t.id, TL, actor(TL));
    jest.spyOn((tickets as any).ticketAccess, 'isSelfAssigned').mockReturnValue(true);
    await tickets.approve(t.id, TL, actor(TL), { taskEfficiencyRating: 5, employeePerformanceRating: 5, employeeAttitudeRating: 5, ratingComment: 'ok' });
    expect((await cyclesOf(t.id))[0]).toMatchObject({
      decision: 'APPROVED', taskEfficiencyRating: null, employeePerformanceRating: null, employeeAttitudeRating: null, ratingComment: 'ok',
    });
  });
});
