/**
 * Phase 1 ticket time engine: acceptance scenarios A–T against real PostgreSQL.
 *
 * Real: Prisma, PostgreSQL, the advisory locks, TicketLedgerService,
 * WorkdayService (start/break/end/resume) and TicketsService.update / block /
 * unblock / approve / reject. Doubled: notifications, the websocket gateway,
 * the event bus, permissions (not what is under test here) and the SLA
 * decorator. Only `Date` is faked, so time can be moved across a break or a
 * night; timers and I/O are real.
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
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';

const WORKER = 'u-worker';
const WORKER2 = 'u-worker-2';
const MANAGER = 'u-manager';

// 2026-08-13 is a Thursday. 03:30Z = 09:00 IST.
const at = (iso: string) => new Date(iso);
const D1 = (hhmm: string) => at(`2026-08-13T${hhmm}:00.000Z`);
const D2 = (hhmm: string) => at(`2026-08-14T${hhmm}:00.000Z`);

describe('T1 ticket time engine (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: TicketLedgerService;
  let workday: WorkdayService;
  let tickets: TicketsService;
  let seq = 0;

  const setNow = (d: Date) => jest.setSystemTime(d);

  const activeLogs = (userId?: string) =>
    prisma.ticketTimeLog.findMany({ where: { endedAt: null, ...(userId ? { userId } : {}) } });
  const logsFor = (ticketId: string) =>
    prisma.ticketTimeLog.findMany({ where: { ticketId }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] });

  async function newTicket(fields: Record<string, any> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        ticketId: `TKT-T1-${seq}`,
        title: `Time engine fixture ${seq}`,
        category: 'IT',
        type: 'TASK',
        createdById: MANAGER,
        assignedToId: WORKER,
        estimatedMinutes: 240,
        ...fields,
      } as any,
    });
  }

  const move = (ticketId: string, status: TicketStatus, actor = WORKER) =>
    tickets.update(ticketId, { status }, actor);

  beforeAll(async () => {
    assertIsolatedDatabase();
    jest.useFakeTimers({
      doNotFake: [
        'nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
        'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance',
      ],
    });
    setNow(D1('03:00'));

    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);

    const tva = new TVAService({ get: () => undefined } as any);
    ledger = new TicketLedgerService(prisma, tva);
    const eventLogger = { log: () => Promise.resolve() };
    const notifications = { sendNotification: async () => null };
    workday = new WorkdayService(
      prisma, {} as any, eventLogger as any, ledger, notifications as any,
      new AttendanceAuthorityService(prisma), tva,
    );
    tickets = new TicketsService(
      prisma,
      { emitTicketStatusChanged: () => undefined } as any,
      notifications as any,
      { get: () => undefined } as any,
      { emit: () => true } as any,
      eventLogger as any,
      { isSelfAssigned: () => false } as any,
      { resolvePrimaryApproverFor: async () => null } as any,
      { getSlaConfig: async () => ({ review: { MEDIUM: 24 } }), decorateTicket: async (t: any) => t } as any,
      ledger,
      {} as any,
    );
  });

  beforeEach(async () => {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.role.createMany({
      data: [
        { id: 'r-manager', name: 'MANAGER', level: 2 },
        { id: 'r-employee', name: 'EMPLOYEE', level: 4 },
      ] as any,
    });
    for (const [id, roleId] of [[WORKER, 'r-employee'], [WORKER2, 'r-employee'], [MANAGER, 'r-manager']]) {
      await prisma.user.create({
        data: {
          id, roleId, name: id, email: `${id}@integration.invalid`, password: 'not-a-real-hash',
          currentStatus: id === MANAGER ? 'WORKING' : 'OFFLINE',
        } as any,
      });
    }
    setNow(D1('03:00'));
  });

  afterAll(async () => {
    jest.useRealTimers();
    // Leave no timer fixtures behind: a post-run integrity audit of the
    // integration database must read CLEAN.
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  it('A. an OPEN ticket has no active log', async () => {
    await workday.startWork(WORKER);
    await newTicket();
    expect(await activeLogs()).toHaveLength(0);
  });

  it('B. START gives the primary assignee an active log and stamps actualStartAt', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket();
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS);

    const active = await activeLogs();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ ticketId: t.id, userId: WORKER, ownerType: 'ASSIGNEE', stage: 'WORK' });
    expect(active[0].startedAt.toISOString()).toBe(D1('04:00').toISOString());
    const row = await prisma.ticket.findUnique({ where: { id: t.id } });
    expect(row!.actualStartAt).not.toBeNull();
  });

  it('C. a manager moving the ticket starts the WORKER\'s timer, never the manager\'s', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket();
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER);

    const active = await activeLogs();
    expect(active).toHaveLength(1);
    expect(active[0].userId).toBe(WORKER);
    expect(await activeLogs(MANAGER)).toHaveLength(0);
  });

  it('D. starting a second ticket pauses the first; exactly one active log', async () => {
    await workday.startWork(WORKER);
    const a = await newTicket();
    const b = await newTicket();
    setNow(D1('04:00'));
    await move(a.id, TicketStatus.IN_PROGRESS);
    setNow(D1('05:00'));
    await move(b.id, TicketStatus.IN_PROGRESS);

    const active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(b.id);
    const [aLog] = await logsFor(a.id);
    expect(aLog).toMatchObject({ pauseReason: 'SWITCHED', durationSeconds: 3600 });
  });

  it('D2. concurrent starts of two tickets (two tabs) never leave two active logs', async () => {
    await workday.startWork(WORKER);
    const a = await newTicket();
    const b = await newTicket();
    await Promise.all([
      ledger.startAssigneeTimer({ ticketId: a.id, workerId: WORKER, mode: 'START', source: 'TICKET_STATUS' }).catch(() => null),
      ledger.startAssigneeTimer({ ticketId: b.id, workerId: WORKER, mode: 'START', source: 'TICKET_STATUS' }).catch(() => null),
    ]);
    // Tickets are OPEN here, so both are ineligible; now make them workable and race again.
    await prisma.ticket.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: 'IN_PROGRESS' } });
    const results = await Promise.all([
      ledger.startAssigneeTimer({ ticketId: a.id, workerId: WORKER, mode: 'START', source: 'TICKET_STATUS' }),
      ledger.startAssigneeTimer({ ticketId: b.id, workerId: WORKER, mode: 'START', source: 'TICKET_STATUS' }),
      ledger.startAssigneeTimer({ ticketId: a.id, workerId: WORKER, mode: 'START', source: 'TICKET_STATUS' }),
    ]);
    expect(results.every((r) => ['STARTED', 'ALREADY_ACTIVE'].includes(r.outcome))).toBe(true);
    expect(await activeLogs(WORKER)).toHaveLength(1);
  });

  it('E/F. break pauses; break end resumes the same ticket once, with no duplicate', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket();
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS);
    setNow(D1('05:00'));
    await workday.startBreak(WORKER, { breakType: 'LUNCH' });
    expect(await activeLogs(WORKER)).toHaveLength(0);

    setNow(D1('05:30'));
    await workday.endBreak(WORKER);
    // A retried break-end resume must not add a second active log.
    const brk = await prisma.breakLog.findFirst({ where: { userId: WORKER } });
    await ledger.resumeLogsForBreak(brk!.id, WORKER);

    const logs = await logsFor(t.id);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ pauseReason: 'BREAK', durationSeconds: 3600, breakLogId: brk!.id });
    expect(logs[1].endedAt).toBeNull();
    expect(logs[1].startedAt.toISOString()).toBe(D1('05:30').toISOString());
    expect(await activeLogs(WORKER)).toHaveLength(1);
  });

  it('G/H. End Day pauses and keeps IN_PROGRESS; next-day Start Work resumes from the new timestamp', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket();
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS);
    setNow(D1('12:00'));
    await workday.endWork(WORKER);

    expect(await activeLogs(WORKER)).toHaveLength(0);
    expect((await prisma.ticket.findUnique({ where: { id: t.id } }))!.status).toBe('IN_PROGRESS');

    // Idempotent finalization: ending again changes nothing.
    await workday.endWork(WORKER);
    expect(await logsFor(t.id)).toHaveLength(1);

    setNow(D2('03:30'));
    await workday.startWork(WORKER);
    const logs = await logsFor(t.id);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ pauseReason: 'LOGOUT', durationSeconds: 8 * 3600 });
    expect(logs[1].endedAt).toBeNull();
    expect(logs[1].startedAt.toISOString()).toBe(D2('03:30').toISOString());

    // Overnight is excluded: 8h day one + 1h day two.
    setNow(D2('04:30'));
    const timers = await ledger.getTicketTimers(await prisma.ticket.findUnique({ where: { id: t.id } }));
    expect(timers.employeeWorkSeconds).toBe(9 * 3600);
  });

  it('H2. next-day resume does not pick a ticket the worker deliberately left (review / switch)', async () => {
    await workday.startWork(WORKER);
    const a = await newTicket();
    setNow(D1('04:00'));
    await move(a.id, TicketStatus.IN_PROGRESS);
    setNow(D1('05:00'));
    await move(a.id, TicketStatus.REVIEW);
    await workday.endWork(WORKER);
    setNow(D2('03:30'));
    await workday.startWork(WORKER);
    expect(await activeLogs(WORKER)).toHaveLength(0);
  });

  it('I/J. block pauses; unblock while WORKING with nothing else active resumes', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket();
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS);
    setNow(D1('05:00'));
    await tickets.blockTicket(t.id, 'Waiting on vendor', MANAGER);
    expect(await activeLogs(WORKER)).toHaveLength(0);
    expect((await logsFor(t.id))[0]).toMatchObject({ pauseReason: 'BLOCKED', durationSeconds: 3600 });

    setNow(D1('06:00'));
    await tickets.unblockTicket(t.id, MANAGER);
    const active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(t.id);
    expect(active[0].startedAt.toISOString()).toBe(D1('06:00').toISOString());
  });

  it('K. unblock while another ticket is active creates no overlap', async () => {
    await workday.startWork(WORKER);
    const a = await newTicket();
    const b = await newTicket();
    await move(a.id, TicketStatus.IN_PROGRESS);
    await tickets.blockTicket(a.id, 'Waiting on vendor', MANAGER);
    await move(b.id, TicketStatus.IN_PROGRESS);
    await tickets.unblockTicket(a.id, MANAGER);

    const active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(b.id);
  });

  it('QA-1. the viewer\'s break never pauses the assignee; the assignee\'s break sets activeClock NONE and freezes work time', async () => {
    // Manual QA repro: a manager moves the worker's ticket to
    // IN_PROGRESS, the manager goes on break, later the worker goes on break.
    await workday.startWork(MANAGER);
    await workday.startWork(WORKER);
    const t = await newTicket();
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER);

    setNow(D1('04:05'));
    await workday.startBreak(MANAGER, { breakType: 'TEA' });
    let row = await prisma.ticket.findUnique({ where: { id: t.id } });
    let timers = await ledger.getTicketTimers(row);
    expect(timers.activeClock).toBe('EMPLOYEE_WORK');
    expect(timers.active!.userId).toBe(WORKER);
    expect(await activeLogs(MANAGER)).toHaveLength(0);

    setNow(D1('04:20'));
    await workday.startBreak(WORKER, { breakType: 'TEA' });
    expect(await activeLogs(WORKER)).toHaveLength(0);
    row = await prisma.ticket.findUnique({ where: { id: t.id } });
    timers = await ledger.getTicketTimers(row);
    expect(row!.status).toBe(TicketStatus.IN_PROGRESS);
    expect(timers.activeClock).toBe('NONE');
    expect(timers.active).toBeNull();
    expect(timers.employeeWorkSeconds).toBe(20 * 60);

    // Still frozen two minutes into the break.
    setNow(D1('04:22'));
    timers = await ledger.getTicketTimers(await prisma.ticket.findUnique({ where: { id: t.id } }));
    expect(timers.activeClock).toBe('NONE');
    expect(timers.employeeWorkSeconds).toBe(20 * 60);
  });

  it('QA-2. OPEN never has an employee clock, and IN_PROGRESS → OPEN closes it immediately', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket();
    let timers = await ledger.getTicketTimers(await prisma.ticket.findUnique({ where: { id: t.id } }));
    expect(timers.activeClock).toBe('NONE');
    expect(timers.employeeWorkSeconds).toBe(0);

    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER);
    setNow(D1('04:10'));
    await move(t.id, TicketStatus.OPEN, MANAGER);
    expect(await activeLogs()).toHaveLength(0);
    setNow(D1('04:30'));
    timers = await ledger.getTicketTimers(await prisma.ticket.findUnique({ where: { id: t.id } }));
    expect(timers.activeClock).toBe('NONE');
    expect(timers.employeeWorkSeconds).toBe(10 * 60);
  });

  it('QA-3. time left = cycle estimate − productive work; frozen on break; rework uses its own estimate; every ticket response carries it', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket({ estimatedMinutes: 60 });
    let b = (await ledger.getWorkBudgets([await prisma.ticket.findUnique({ where: { id: t.id } })])).get(t.id)!;
    expect(b).toMatchObject({ cycle: 'ORIGINAL', estimatedMinutes: 60, workedSeconds: 0, remainingSeconds: 3600, running: false });

    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER);
    setNow(D1('04:06'));
    b = (await ledger.getWorkBudgets([await prisma.ticket.findUnique({ where: { id: t.id } })])).get(t.id)!;
    expect(b).toMatchObject({ workedSeconds: 6 * 60, remainingSeconds: 54 * 60, running: true }); // 1h − 6m = 54m

    await workday.startBreak(WORKER, { breakType: 'TEA' });
    setNow(D1('04:36'));
    b = (await ledger.getWorkBudgets([await prisma.ticket.findUnique({ where: { id: t.id } })])).get(t.id)!;
    expect(b).toMatchObject({ workedSeconds: 6 * 60, remainingSeconds: 54 * 60, running: false }); // break never uses it up

    // Ticket responses (same path as list/kanban, which batch it) carry the same numbers.
    const listed = await (tickets as any).addSla(await prisma.ticket.findUnique({ where: { id: t.id } }));
    expect(listed.workBudget).toMatchObject({ estimatedMinutes: 60, remainingSeconds: 54 * 60, running: false });

    await workday.endBreak(WORKER);
    setNow(D1('04:40'));
    await move(t.id, TicketStatus.REVIEW);
    setNow(D1('05:00'));
    await tickets.reject(t.id, 'Redo', MANAGER, undefined, 30);
    setNow(D1('05:10'));
    b = (await ledger.getWorkBudgets([await prisma.ticket.findUnique({ where: { id: t.id } })])).get(t.id)!;
    expect(b).toMatchObject({ cycle: 'REWORK', estimatedMinutes: 30, workedSeconds: 10 * 60, remainingSeconds: 20 * 60, running: true });
  });

  it('QA-4. the clock follows only the primary assignee: the creator\'s break and end day never pause it, the assignee\'s break does', async () => {
    // Manual QA: created by one user (MANAGER), assigned to another (WORKER).
    await workday.startWork(MANAGER);
    await workday.startWork(WORKER);
    const t = await newTicket({ estimatedMinutes: 60 });
    const created = await prisma.ticket.findUnique({ where: { id: t.id } });
    expect(created!.createdById).toBe(MANAGER);
    expect(created!.assignedToId).toBe(WORKER);

    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER);
    expect(await activeLogs(MANAGER)).toHaveLength(0);
    expect(await activeLogs(WORKER)).toHaveLength(1);

    // Creator on break, then ends the day: the assignee's clock keeps running.
    setNow(D1('04:10'));
    await workday.startBreak(MANAGER, { breakType: 'TEA' });
    setNow(D1('04:20'));
    await workday.endBreak(MANAGER);
    setNow(D1('04:25'));
    await workday.endWork(MANAGER);
    expect(await activeLogs(WORKER)).toHaveLength(1);
    expect(await activeLogs(MANAGER)).toHaveLength(0);

    // Assignee's break pauses it at exactly 30 minutes of work.
    setNow(D1('04:30'));
    await workday.startBreak(WORKER, { breakType: 'TEA' });
    expect(await activeLogs(WORKER)).toHaveLength(0);
    let b = (await ledger.getWorkBudgets([await prisma.ticket.findUnique({ where: { id: t.id } })])).get(t.id)!;
    expect(b).toMatchObject({ workedSeconds: 30 * 60, remainingSeconds: 30 * 60, running: false });

    // The creator starting work again does not resume the assignee's clock.
    setNow(D1('04:40'));
    await workday.startWork(MANAGER);
    expect(await activeLogs(WORKER)).toHaveLength(0);
    expect(await activeLogs(MANAGER)).toHaveLength(0);

    // Only the assignee's break end resumes it.
    setNow(D1('04:45'));
    await workday.endBreak(WORKER);
    setNow(D1('04:50'));
    b = (await ledger.getWorkBudgets([await prisma.ticket.findUnique({ where: { id: t.id } })])).get(t.id)!;
    expect(b).toMatchObject({ workedSeconds: 35 * 60, remainingSeconds: 25 * 60, running: true });
    const owners = new Set((await logsFor(t.id)).map((l: any) => l.userId));
    expect([...owners]).toEqual([WORKER]);
  });

  it('QA-5. handover to an assignee on break starts on their own break end, never on the manager\'s', async () => {
    await workday.startWork(WORKER);
    await workday.startWork(WORKER2);
    await workday.startWork(MANAGER);
    const t = await newTicket();
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER);
    await workday.startBreak(WORKER2, { breakType: 'TEA' });
    await workday.startBreak(MANAGER, { breakType: 'TEA' });
    await tickets.update(t.id, { assignedToId: WORKER2 }, MANAGER);
    expect(await activeLogs()).toHaveLength(0);

    setNow(D1('04:10'));
    await workday.endBreak(MANAGER);
    expect(await activeLogs()).toHaveLength(0);

    setNow(D1('04:20'));
    await workday.endBreak(WORKER2);
    const active = await activeLogs();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ userId: WORKER2, ticketId: t.id });
    expect(active[0].startedAt.toISOString()).toBe(D1('04:20').toISOString());
  });

  it('QA-6. handover to an assignee who is off shift starts on their own Start Work', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket();
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER);
    await tickets.update(t.id, { assignedToId: WORKER2 }, MANAGER);
    expect(await activeLogs()).toHaveLength(0);

    setNow(D1('05:00'));
    await workday.startWork(WORKER2);
    const active = await activeLogs();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ userId: WORKER2, ticketId: t.id });
    expect(active[0].startedAt.toISOString()).toBe(D1('05:00').toISOString());
  });

  it('QA-7. a handover never displaces the new assignee\'s own paused ticket', async () => {
    await workday.startWork(WORKER);
    await workday.startWork(WORKER2);
    const own = await newTicket({ assignedToId: WORKER2 });
    const handed = await newTicket({ assignedToId: WORKER });
    setNow(D1('04:00'));
    await move(own.id, TicketStatus.IN_PROGRESS, MANAGER);
    await move(handed.id, TicketStatus.IN_PROGRESS, MANAGER);

    setNow(D1('04:30'));
    await workday.startBreak(WORKER2, { breakType: 'TEA' });
    await tickets.update(handed.id, { assignedToId: WORKER2 }, MANAGER);

    setNow(D1('04:40'));
    await workday.endBreak(WORKER2);
    const active = await activeLogs(WORKER2);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(own.id);
    expect(await activeLogs(WORKER)).toHaveLength(0);
  });

  it('QA-8. idle is not ticket work: going idle pauses at idle start, resume restarts from now, a later close never counts the idle stretch', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket({ estimatedMinutes: 120 });
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER);

    // Reported at 04:50 after 30 idle minutes: work ends at 04:20.
    setNow(D1('04:50'));
    await workday.reportIdle(WORKER, 30);
    expect(await activeLogs(WORKER)).toHaveLength(0);
    let logs = await logsFor(t.id);
    expect(logs[0]).toMatchObject({ pauseReason: 'IDLE', durationSeconds: 20 * 60 });
    expect(logs[0].endedAt!.toISOString()).toBe(D1('04:20').toISOString());

    // Resume Work from idle restarts the clock now.
    setNow(D1('05:00'));
    await workday.resumeWork(WORKER);
    const active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(t.id);
    expect(active[0].startedAt.toISOString()).toBe(D1('05:00').toISOString());

    // Idle again, then the day is closed much later: only 05:00-05:15 counts.
    setNow(D1('05:40'));
    await workday.reportIdle(WORKER, 25);
    setNow(D1('07:00'));
    await workday.endWork(WORKER);
    logs = await logsFor(t.id);
    expect(logs.reduce((acc: number, l: any) => acc + (l.durationSeconds ?? 0), 0)).toBe(35 * 60);
    expect(await activeLogs()).toHaveLength(0);
  });

  it('QA-9. /workday/resume from a break ends the break and resumes the ticket, like the break banner', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket();
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER);
    setNow(D1('04:10'));
    await workday.startBreak(WORKER, { breakType: 'TEA' });
    expect(await activeLogs(WORKER)).toHaveLength(0);

    setNow(D1('04:30'));
    await workday.resumeWork(WORKER);
    const openBreaks = await prisma.breakLog.findMany({ where: { userId: WORKER, endAt: null } });
    expect(openBreaks).toHaveLength(0);
    const active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(t.id);
    expect(active[0].startedAt.toISOString()).toBe(D1('04:30').toISOString());
  });

  const pauseOf = async (id: string) =>
    (await ledger.getPauseStates([await prisma.ticket.findUnique({ where: { id } })])).get(id) ?? null;

  it('QA-10. yesterday\'s paused tickets are never stranded: a new ticket started before punch-in runs first, then the queue resumes the rest in order', async () => {
    // Day 1: a then b (a SWITCHED), End Day pauses b (LOGOUT).
    await workday.startWork(WORKER);
    const a = await newTicket();
    const b = await newTicket();
    setNow(D1('04:00'));
    await move(a.id, TicketStatus.IN_PROGRESS);
    setNow(D1('05:00'));
    await move(b.id, TicketStatus.IN_PROGRESS);
    setNow(D1('12:00'));
    await workday.endWork(WORKER);
    expect(await activeLogs()).toHaveLength(0);

    // Day 2, before punch-in: a manager starts a new ticket for the worker.
    const c = await newTicket();
    setNow(D2('03:00'));
    await move(c.id, TicketStatus.IN_PROGRESS, MANAGER);
    expect(await activeLogs()).toHaveLength(0);
    expect(await pauseOf(c.id)).toMatchObject({ reason: 'PUNCHED_OUT' });

    // Punch-in: the newest (c) runs; a and b wait on it, with the reason.
    setNow(D2('03:30'));
    await workday.startWork(WORKER);
    let active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(c.id);
    expect(await pauseOf(b.id)).toMatchObject({ reason: 'WORKING_ON_OTHER', otherTicketId: c.id, otherTicketKey: c.ticketId });
    expect(await pauseOf(a.id)).toMatchObject({ reason: 'WORKING_ON_OTHER', otherTicketId: c.id });

    // c goes to Review: b (last worked on) resumes automatically, then a.
    setNow(D2('04:00'));
    await move(c.id, TicketStatus.REVIEW);
    active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(b.id);
    expect(active[0].startedAt.toISOString()).toBe(D2('04:00').toISOString());

    setNow(D2('05:00'));
    await move(b.id, TicketStatus.OPEN, MANAGER);
    active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(a.id);

    // Review / Open tickets never resume.
    setNow(D2('06:00'));
    await move(a.id, TicketStatus.REVIEW);
    expect(await activeLogs(WORKER)).toHaveLength(0);
  });

  it('QA-11. punch-in with only yesterday\'s tickets resumes the one she was last on; after a deliberate stop the next waiting ticket resumes', async () => {
    await workday.startWork(WORKER);
    const a = await newTicket();
    const b = await newTicket();
    setNow(D1('04:00'));
    await move(a.id, TicketStatus.IN_PROGRESS);
    setNow(D1('05:00'));
    await move(b.id, TicketStatus.IN_PROGRESS);
    setNow(D1('12:00'));
    await workday.endWork(WORKER);

    setNow(D2('03:30'));
    await workday.startWork(WORKER);
    let active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(b.id); // last worked on

    // b goes to Review: a, still waiting from yesterday, resumes on its own.
    setNow(D2('04:00'));
    await move(b.id, TicketStatus.REVIEW);
    active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(a.id); // queue, immediately
  });

  it('QA-12. the pause reason follows the assignee\'s live state', async () => {
    await workday.startWork(WORKER);
    const a = await newTicket();
    const b = await newTicket();
    setNow(D1('04:00'));
    await move(a.id, TicketStatus.IN_PROGRESS);
    setNow(D1('04:10'));
    await move(b.id, TicketStatus.IN_PROGRESS);
    expect(await pauseOf(b.id)).toBeNull(); // running
    expect(await pauseOf(a.id)).toMatchObject({ reason: 'WORKING_ON_OTHER', otherTicketId: b.id });

    setNow(D1('04:20'));
    await workday.startBreak(WORKER, { breakType: 'TEA' });
    expect(await pauseOf(a.id)).toMatchObject({ reason: 'ON_BREAK' });
    expect(await pauseOf(b.id)).toMatchObject({ reason: 'ON_BREAK' });
    setNow(D1('04:30'));
    await workday.endBreak(WORKER);

    // Blocking the running ticket pauses it (BLOCKED) and the queue starts a.
    setNow(D1('04:40'));
    await tickets.blockTicket(b.id, 'Waiting on vendor', MANAGER);
    expect(await pauseOf(b.id)).toMatchObject({ reason: 'BLOCKED' });
    const active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(a.id);

    setNow(D1('12:00'));
    await workday.endWork(WORKER);
    expect(await pauseOf(a.id)).toMatchObject({ reason: 'PUNCHED_OUT' });

    // The ticket API exposes it on timers.
    const timers = await ledger.getTicketTimers(await prisma.ticket.findUnique({ where: { id: a.id } }));
    expect(timers.pause).toMatchObject({ reason: 'PUNCHED_OUT' });
  });

  it('QA-13. a previous day left open (no punch out) is closed at its cutoff on next Start Work; a late close never cuts today\'s clock', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket();
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS);
    const day1 = await prisma.workSession.findFirst({ where: { userId: WORKER }, orderBy: { createdAt: 'desc' } });
    // No End Day, and the scheduler has not run: day 1 is still open overnight.

    setNow(D2('03:30'));
    await workday.startWork(WORKER);

    const closedDay1 = await prisma.workSession.findUnique({ where: { id: day1!.id } });
    expect(closedDay1!.status).toBe('AUTO_CLOSED');
    const logs = await logsFor(t.id);
    expect(logs).toHaveLength(2);
    // Day 1's segment ends at day 1's cutoff (never overnight), reason SYSTEM.
    expect(logs[0]).toMatchObject({ pauseReason: 'SYSTEM', workSessionId: day1!.id });
    expect(logs[0].endedAt!.getTime()).toBeLessThanOrEqual(D1('18:30').getTime()); // ≤ 23:59 IST
    // Today's segment runs from the new Start Work, in today's session.
    expect(logs[1].endedAt).toBeNull();
    expect(logs[1].startedAt.toISOString()).toBe(D2('03:30').toISOString());
    expect(logs[1].workSessionId).not.toBe(day1!.id);

    // A late reconciliation of day 1 (the scheduler tick) must not touch today's clock.
    setNow(D2('03:45'));
    await workday.finalizeWorkSession(day1!.id, {
      effectiveEndAt: D1('18:29'),
      terminalStatus: 'AUTO_CLOSED',
      closureReason: 'AUTO_CLOSE',
      eventSource: 'system',
      attendanceEventType: 'AUTO_CLOSE',
      ticketPauseReason: 'SYSTEM',
    });
    const active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(logs[1].id);
  });

  it('L/M/S. REVIEW closes the log; approval keeps it closed; lifecycle = first IN_PROGRESS → DONE', async () => {
    await workday.startWork(WORKER);
    setNow(D1('02:30')); // 08:00 IST creation
    const t = await newTicket();
    setNow(D1('04:30')); // 10:00 IST first IN_PROGRESS
    await move(t.id, TicketStatus.IN_PROGRESS);
    setNow(D1('06:30'));
    await move(t.id, TicketStatus.REVIEW);
    expect(await activeLogs()).toHaveLength(0);

    setNow(D1('08:30'));
    await tickets.approve(t.id, MANAGER);
    expect(await activeLogs()).toHaveLength(0);

    const row = await prisma.ticket.findUnique({ where: { id: t.id } });
    const timers = await ledger.getTicketTimers(row);
    expect(timers.lifecycle.startedAt!.toISOString()).toBe(D1('04:30').toISOString());
    expect(timers.lifecycle.endedAt!.toISOString()).toBe(D1('08:30').toISOString());
    expect(timers.lifecycle.endState).toBe('DONE');
    expect(timers.totalTicketSeconds).toBe(4 * 3600);
    expect(timers.employeeWorkSeconds).toBe(2 * 3600);
    expect(timers.reviewerApprovalSeconds).toBe(2 * 3600);
    expect(timers.original).toEqual({ estimatedMinutes: 240, actualSeconds: 2 * 3600 });
    // No reviewer/manager timer was ever created.
    expect(await prisma.ticketTimeLog.count({ where: { userId: MANAGER } })).toBe(0);
  });

  it('N/O/P/Q/R. rework belongs to the worker, has its own estimate, excludes breaks, and two reworks are separate', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket({ estimatedMinutes: 240 });
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS);
    setNow(D1('06:00'));
    await move(t.id, TicketStatus.REVIEW);

    // Rework 1 with a 2h estimate, sent back by the manager.
    setNow(D1('07:00'));
    await tickets.reject(t.id, 'Fix the totals', MANAGER, undefined, 120);
    let active = await activeLogs();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ userId: WORKER, stage: 'REWORK' }); // N

    setNow(D1('07:30'));
    await workday.startBreak(WORKER, { breakType: 'TEA' });
    setNow(D1('08:00'));
    await workday.endBreak(WORKER);
    setNow(D1('08:30'));
    await move(t.id, TicketStatus.REVIEW); // Q: 30m + 30m of rework, the break excluded (P)

    let cycles = await prisma.reviewCycleLog.findMany({ where: { ticketId: t.id }, orderBy: { cycleNo: 'asc' } });
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({ decision: 'REWORK', reworkEstimatedMinutes: 120, reworkWorkSeconds: 3600 });
    expect(cycles[0].reworkEndedAt!.toISOString()).toBe(D1('08:30').toISOString());
    expect((await prisma.ticket.findUnique({ where: { id: t.id } }))!.estimatedMinutes).toBe(240); // O

    // Rework 2 via a direct status change (Kanban path), no estimate.
    setNow(D1('09:00'));
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER);
    setNow(D1('09:45'));
    await move(t.id, TicketStatus.REVIEW);

    cycles = await prisma.reviewCycleLog.findMany({ where: { ticketId: t.id }, orderBy: { cycleNo: 'asc' } });
    expect(cycles).toHaveLength(2);
    expect(cycles[1]).toMatchObject({ decision: 'REWORK', reworkEstimatedMinutes: null, reworkWorkSeconds: 45 * 60 });
    expect(cycles[0].reworkWorkSeconds).toBe(3600); // R: first cycle preserved

    const row = await prisma.ticket.findUnique({ where: { id: t.id } });
    expect(row!.reworkCount).toBe(2);
    const timers = await ledger.getTicketTimers(row);
    expect(timers.original.actualSeconds).toBe(2 * 3600);
    expect(timers.reworks.map((r: any) => [r.estimatedMinutes, r.actualSeconds])).toEqual([[120, 3600], [null, 45 * 60]]);
    expect(await prisma.ticketTimeLog.count({ where: { userId: MANAGER } })).toBe(0);
  });

  it('T. a ticket without a Start Time is created, started and timed normally', async () => {
    await workday.startWork(WORKER);
    const t = await newTicket({ scheduledStartAt: null, scheduledEndAt: null });
    await move(t.id, TicketStatus.IN_PROGRESS);
    expect(await activeLogs(WORKER)).toHaveLength(1);
  });

  it('deferred start: a ticket started for an offline worker resumes at their next workday start', async () => {
    const t = await newTicket();
    setNow(D1('04:00'));
    await move(t.id, TicketStatus.IN_PROGRESS, MANAGER); // worker never started work
    expect(await activeLogs()).toHaveLength(0);
    const [marker] = await logsFor(t.id);
    expect(marker).toMatchObject({ userId: WORKER, pauseReason: 'AWAITING_WORKDAY', durationSeconds: 0 });

    setNow(D1('05:00'));
    await workday.startWork(WORKER);
    const active = await activeLogs(WORKER);
    expect(active).toHaveLength(1);
    expect(active[0].startedAt.toISOString()).toBe(D1('05:00').toISOString());
  });

  it('reassigning an IN_PROGRESS ticket hands the clock to the new assignee', async () => {
    await workday.startWork(WORKER);
    await workday.startWork(WORKER2);
    const t = await newTicket();
    await move(t.id, TicketStatus.IN_PROGRESS);
    await tickets.update(t.id, { assignedToId: WORKER2 }, MANAGER);

    expect(await activeLogs(WORKER)).toHaveLength(0);
    const active = await activeLogs(WORKER2);
    expect(active).toHaveLength(1);
    expect(active[0].ticketId).toBe(t.id);
  });
});
