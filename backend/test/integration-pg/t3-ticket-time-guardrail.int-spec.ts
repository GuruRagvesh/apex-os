/**
 * Phase 2D1 against real PostgreSQL: the ticket timer cleanup (dry run and
 * apply), the one-active-timer unique index migration, and concurrent timer
 * starts under that index.
 *
 * The cleanup and migration tests reproduce a database from BEFORE the
 * guardrail, so the suite drops the index first and always restores it (by
 * running the real migration) before it finishes.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TVAService } from '../../src/common/services/tva.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import {
  ONE_ACTIVE_INDEX,
  applyOneActiveMigration,
  dropOneActiveIndex,
  oneActiveIndexState,
  restoreOneActiveIndex,
} from './one-active-index';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';
import {
  REPAIR_PAUSE_REASON,
  runCleanupApply,
  runCleanupDryRun,
} from '../../scripts/lib/ticket-time-cleanup';

const W = 'u-guard-worker';
const W2 = 'u-guard-worker-2';
const M = 'u-guard-manager';

const at = (iso: string) => new Date(iso);
const TODAY = at('2026-08-13T00:00:00.000Z');
const REPAIR_AT = at('2026-08-13T06:00:00.000Z');
const TABLES = ['ticket_time_logs', 'tickets', 'users', 'work_sessions', 'review_cycle_logs'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('T3 ticket timer guardrail (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: TicketLedgerService;

  const opts = (over: Partial<{ sampleLimit: number }> = {}) => ({ repairAt: REPAIR_AT, sampleLimit: 20, ...over });

  async function fingerprint(tables = TABLES) {
    const out: Record<string, string> = {};
    for (const table of tables) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ${table} t`,
      );
      out[table] = `${row.n}:${row.h}`;
    }
    return out;
  }

  const rowsHash = async (where: string) => {
    const [r] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ticket_time_logs t WHERE ${where}`,
    );
    return r.h as string;
  };

  const activeAssignee = (userId: string) =>
    prisma.ticketTimeLog.findMany({ where: { userId, ownerType: 'ASSIGNEE', endedAt: null }, orderBy: { id: 'asc' } });

  function log(fields: Record<string, any>) {
    return prisma.ticketTimeLog.create({
      data: { userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', countsAsWork: true, ...fields } as any,
    });
  }

  /** W WORKING in today's open session; five tickets; one completed segment. No active timer. */
  async function seedBase() {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.role.create({ data: { id: 'r-guard', name: 'EMPLOYEE', level: 4 } as any });
    for (const id of [W, W2, M]) {
      await prisma.user.create({
        data: {
          id, roleId: 'r-guard', name: `Person ${id}`, email: `${id}@integration.invalid`,
          password: 'not-a-real-hash', currentStatus: id === W ? 'WORKING' : 'OFFLINE',
        } as any,
      });
    }
    await prisma.workSession.create({
      data: { id: 's-today', userId: W, date: TODAY, loginAt: at('2026-08-13T03:30:00Z'), startWorkAt: at('2026-08-13T03:30:00Z'), status: 'WORKING' },
    });
    const tickets: Array<[string, string, string, string, boolean]> = [
      ['t-1', 'TKT-G-1', 'IN_PROGRESS', W, false],
      ['t-2', 'TKT-G-2', 'IN_PROGRESS', W, false],
      ['t-3', 'TKT-G-3', 'REVIEW', W, false],
      ['t-4', 'TKT-G-4', 'IN_PROGRESS', W, true],
      ['t-5', 'TKT-G-5', 'IN_PROGRESS', W2, false],
    ];
    for (const [id, key, status, assignee, blocked] of tickets) {
      await prisma.ticket.create({
        data: { id, ticketId: key, title: `Guardrail fixture ${key}`, category: 'IT', type: 'TASK', createdById: M, assignedToId: assignee, status, isBlocked: blocked } as any,
      });
    }
    await log({ id: 'l-history', ticketId: 't-2', startedAt: at('2026-08-12T10:00:00Z'), endedAt: at('2026-08-12T11:00:00Z'), durationSeconds: 3600 });
  }

  /**
   * The pre-guardrail mess (index must be dropped):
   *  - W runs two valid timers (t-1 since 05:00, t-2 since 05:30): keep t-2.
   *  - W has an active timer on a REVIEW ticket and one on a blocked ticket
   *    that "starts" in the future (clock skew).
   *  - W2 is OFFLINE with a session-less active timer.
   *  - M has an active REVIEWER timer, which the cleanup must not touch.
   */
  async function seedMess() {
    await log({ id: 'l-1', ticketId: 't-1', startedAt: at('2026-08-13T05:00:00Z'), workSessionId: 's-today' });
    await log({ id: 'l-2', ticketId: 't-2', startedAt: at('2026-08-13T05:30:00Z'), workSessionId: 's-today' });
    await log({ id: 'l-review', ticketId: 't-3', startedAt: at('2026-08-13T04:00:00Z'), workSessionId: 's-today' });
    await log({ id: 'l-future', ticketId: 't-4', startedAt: at('2026-08-13T07:00:00Z'), workSessionId: 's-today' });
    await log({ id: 'l-w2', ticketId: 't-5', userId: W2, startedAt: at('2026-08-13T05:10:00Z') });
    await log({ id: 'l-reviewer', ticketId: 't-3', userId: M, ownerType: 'REVIEWER', stage: 'REVIEW', startedAt: at('2026-08-13T04:00:00Z') });
  }

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    ledger = new TicketLedgerService(prisma, new TVAService({ get: () => undefined } as any));
    await dropOneActiveIndex(prisma);
  });

  beforeEach(async () => {
    await dropOneActiveIndex(prisma);
    await seedBase();
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    if (prisma) await restoreOneActiveIndex(prisma);
    await prisma?.$disconnect();
  });

  // ── Dry run ────────────────────────────────────────────────────────────────

  describe('dry run', () => {
    it('reports CLEAN when nothing is wrong', async () => {
      await log({ id: 'l-1', ticketId: 't-1', startedAt: at('2026-08-13T05:00:00Z'), workSessionId: 's-today' });
      const r = await runCleanupDryRun(prisma as any, opts());
      expect(r).toMatchObject({ mode: 'dry-run', result: 'CLEAN', inspectedActiveRows: 1, rowsToClose: 0, affectedUsers: 0 });
    });

    it('finds duplicates and invalid timers, picks the survivor, and writes nothing', async () => {
      await seedMess();
      const before = await fingerprint();
      const r = await runCleanupDryRun(prisma as any, opts());
      expect(await fingerprint()).toEqual(before);

      expect(r).toMatchObject({ result: 'CHANGES_REQUIRED', inspectedActiveRows: 5, rowsToClose: 4, affectedUsers: 2 });
      expect(r.database).toMatchObject({ name: 'apex_os_attendance_integration', address: '127.0.0.1' });
      expect(r.survivors).toEqual([{ userId: W, keptLogId: 'l-2', keptTicketKey: 'TKT-G-2', closedLogIds: ['l-1'] }]);
      // Ordered by user id, then log id.
      expect(r.samples.map((s) => [s.logId, s.reasons])).toEqual([
        ['l-1', ['DUPLICATE_NOT_SURVIVOR']],
        ['l-future', ['TICKET_BLOCKED']],
        ['l-review', ['TICKET_NOT_IN_PROGRESS']],
        ['l-w2', ['USER_NOT_WORKING', 'NO_OPEN_WORKING_SESSION', 'SESSION_MISSING']],
      ]);
      expect(Object.fromEntries(Object.entries(r.reasonCounts).filter(([, n]) => n > 0))).toEqual({
        TICKET_NOT_IN_PROGRESS: 1,
        TICKET_BLOCKED: 1,
        USER_NOT_WORKING: 1,
        NO_OPEN_WORKING_SESSION: 1,
        SESSION_MISSING: 1,
        DUPLICATE_NOT_SURVIVOR: 1,
      });
    });

    it('samples are bounded, deterministic and carry ids and ticket keys only', async () => {
      await seedMess();
      const a = await runCleanupDryRun(prisma as any, opts({ sampleLimit: 2 }));
      const b = await runCleanupDryRun(prisma as any, opts({ sampleLimit: 2 }));
      expect(a).toEqual(b);
      expect(a.samples).toHaveLength(2);
      expect(a.rowsToClose).toBe(4);
      expect(JSON.stringify(a)).not.toMatch(/@integration\.invalid|Person u-guard|not-a-real-hash/);
    });
  });

  // ── Apply ──────────────────────────────────────────────────────────────────

  describe('apply', () => {
    it('closes exactly the planned rows, keeps one timer, and leaves everything else alone', async () => {
      await seedMess();
      const untouched = {
        history: await rowsHash(`id = 'l-history'`),
        reviewer: await rowsHash(`id = 'l-reviewer'`),
        survivor: await rowsHash(`id = 'l-2'`),
      };
      const others = await fingerprint(['tickets', 'users', 'work_sessions', 'review_cycle_logs']);

      const r = await runCleanupApply(prisma as any, opts());
      expect(r).toMatchObject({ mode: 'apply', result: 'APPLIED', rowsToClose: 4, affectedUsers: 2 });

      const closed = await prisma.ticketTimeLog.findMany({ where: { id: { in: ['l-1', 'l-review', 'l-future', 'l-w2'] } }, orderBy: { id: 'asc' } });
      for (const l of closed) {
        const end = l.startedAt > REPAIR_AT ? l.startedAt : REPAIR_AT;
        expect(l.endedAt).toEqual(end);
        expect(l.durationSeconds).toBe(Math.floor((end.getTime() - l.startedAt.getTime()) / 1000));
        expect(l.durationSeconds).toBeGreaterThanOrEqual(0);
        expect(l.countsAsWork).toBe(false);
        expect(l.pauseReason).toBe(REPAIR_PAUSE_REASON);
        // updatedAt is the same effective end, never earlier than endedAt.
        expect(l.updatedAt).toEqual(end);
      }
      // The future-dated row (starts after the repair time): zero duration,
      // ends where it starts, and updatedAt is not earlier than endedAt.
      const future = closed.find((l) => l.id === 'l-future')!;
      expect(future.durationSeconds).toBe(0);
      expect(future.endedAt).toEqual(future.startedAt);
      expect(future.updatedAt.getTime()).toBeGreaterThanOrEqual(future.endedAt!.getTime());

      expect((await activeAssignee(W)).map((l) => l.id)).toEqual(['l-2']);
      expect(await activeAssignee(W2)).toHaveLength(0);
      expect(await prisma.ticketTimeLog.count()).toBe(7); // nothing deleted
      expect({
        history: await rowsHash(`id = 'l-history'`),
        reviewer: await rowsHash(`id = 'l-reviewer'`),
        survivor: await rowsHash(`id = 'l-2'`),
      }).toEqual(untouched);
      expect(await fingerprint(['tickets', 'users', 'work_sessions', 'review_cycle_logs'])).toEqual(others);

      // Phase 2C agrees the timer data is now clean.
      const audit = await runReadOnlyAudit(prisma as any, { now: REPAIR_AT, staleHours: 12, sampleLimit: 5 });
      expect(audit.result).toBe('CLEAN');
    });

    it('is idempotent: a second apply changes nothing', async () => {
      await seedMess();
      await runCleanupApply(prisma as any, opts());
      const before = await fingerprint();
      const again = await runCleanupApply(prisma as any, { repairAt: at('2026-08-13T06:30:00Z'), sampleLimit: 20 });
      expect(again).toMatchObject({ result: 'CLEAN', rowsToClose: 0 });
      expect(await fingerprint()).toEqual(before);
    });

    it('rolls every change back when a repair step fails', async () => {
      await seedMess();
      const before = await fingerprint();
      await expect(
        runCleanupApply(prisma as any, opts(), {
          afterRowClosed: (i) => {
            if (i === 2) throw new Error('injected failure after the third row');
          },
        }),
      ).rejects.toThrow('injected failure');
      expect(await fingerprint()).toEqual(before);
    });
  });

  // ── Active REWORK timers without an open rework cycle ─────────────────────

  describe('REWORK_WITHOUT_OPEN_CYCLE', () => {
    /**
     * W runs a REWORK timer on t-1, which has no open rework cycle (invalid),
     * and has an ended historical REWORK row there. W2 runs a REWORK timer on
     * t-5 inside an open rework cycle (valid).
     */
    async function seedRework() {
      await prisma.user.update({ where: { id: W2 }, data: { currentStatus: 'WORKING' } });
      await prisma.workSession.create({
        data: { id: 's-w2', userId: W2, date: TODAY, loginAt: at('2026-08-13T03:30:00Z'), startWorkAt: at('2026-08-13T03:30:00Z'), status: 'WORKING' },
      });
      await prisma.reviewCycleLog.create({
        data: { ticketId: 't-5', cycleNo: 1, decision: 'REWORK', reviewStartedAt: at('2026-08-13T04:00:00Z'), reviewEndedAt: at('2026-08-13T04:30:00Z'), reworkStartedAt: at('2026-08-13T04:30:00Z') },
      });
      await log({ id: 'l-rw-hist', ticketId: 't-1', stage: 'REWORK', startedAt: at('2026-08-12T09:00:00Z'), endedAt: at('2026-08-12T09:30:00Z'), durationSeconds: 1800 });
      await log({ id: 'l-rw-bad', ticketId: 't-1', stage: 'REWORK', startedAt: at('2026-08-13T05:00:00Z'), workSessionId: 's-today' });
      await log({ id: 'l-rw-ok', ticketId: 't-5', userId: W2, stage: 'REWORK', startedAt: at('2026-08-13T05:00:00Z'), workSessionId: 's-w2' });
    }
    const auditAt = () => runReadOnlyAudit(prisma as any, { now: REPAIR_AT, staleHours: 12, sampleLimit: 5 });
    const reworkFinding = async () =>
      (await auditAt()).checks.find((c) => c.code === 'ACTIVE_REWORK_LOG_WITHOUT_OPEN_CYCLE')!.count;

    it('dry run reports exactly the invalid REWORK timer and changes nothing', async () => {
      await seedRework();
      expect(await reworkFinding()).toBe(1);
      const before = await fingerprint();
      const r = await runCleanupDryRun(prisma as any, opts());
      expect(await fingerprint()).toEqual(before);
      expect(r).toMatchObject({ result: 'CHANGES_REQUIRED', inspectedActiveRows: 2, rowsToClose: 1, affectedUsers: 1 });
      expect(r.samples).toEqual([{ logId: 'l-rw-bad', userId: W, ticketKey: 'TKT-G-1', reasons: ['REWORK_WITHOUT_OPEN_CYCLE'] }]);
      expect(r.reasonCounts.REWORK_WITHOUT_OPEN_CYCLE).toBe(1);
      expect(r.survivors).toEqual([]);
    });

    it('apply closes it, leaves the valid and historical REWORK rows alone, and is idempotent', async () => {
      await seedRework();
      const keep = { ok: await rowsHash(`id = 'l-rw-ok'`), hist: await rowsHash(`id = 'l-rw-hist'`) };

      const r = await runCleanupApply(prisma as any, opts());
      expect(r).toMatchObject({ result: 'APPLIED', rowsToClose: 1 });
      const bad = await prisma.ticketTimeLog.findUnique({ where: { id: 'l-rw-bad' } });
      expect(bad).toMatchObject({ endedAt: REPAIR_AT, durationSeconds: 3600, countsAsWork: false, pauseReason: REPAIR_PAUSE_REASON, stage: 'REWORK' });
      expect({ ok: await rowsHash(`id = 'l-rw-ok'`), hist: await rowsHash(`id = 'l-rw-hist'`) }).toEqual(keep);

      const before = await fingerprint();
      expect(await runCleanupApply(prisma as any, opts())).toMatchObject({ result: 'CLEAN', rowsToClose: 0 });
      expect(await fingerprint()).toEqual(before);

      expect(await reworkFinding()).toBe(0);
      expect((await auditAt()).result).toBe('CLEAN');
    });
  });

  // ── Repaired (countsAsWork = false) time is never productive ──────────────

  describe('repaired time is not productive', () => {
    const START = at('2026-08-13T04:00:00Z');

    beforeAll(() => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
          'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'],
      });
      jest.setSystemTime(REPAIR_AT);
    });
    afterAll(() => jest.useRealTimers());

    /**
     * t-1 and t-2 are identical (estimate 60 min, same start, same productive
     * rows) except t-1 also carries an ended INTEGRITY_REPAIR row with a
     * large duration. Every productive figure must match; so must lifecycle.
     */
    async function seedPair(rework: boolean) {
      await prisma.ticketTimeLog.deleteMany({ where: { id: 'l-history' } });
      for (const id of ['t-1', 't-2']) {
        await prisma.ticket.update({ where: { id }, data: { estimatedMinutes: 60, actualStartAt: START } });
        await log({ id: `${id}-p1`, ticketId: id, startedAt: START, endedAt: at('2026-08-13T04:10:00Z'), durationSeconds: 600 });
        if (rework) {
          await prisma.reviewCycleLog.create({
            data: { ticketId: id, cycleNo: 1, decision: 'REWORK', reviewStartedAt: at('2026-08-13T04:20:00Z'), reviewEndedAt: at('2026-08-13T05:00:00Z'), reworkStartedAt: at('2026-08-13T05:00:00Z'), reworkEstimatedMinutes: 30 },
          });
          await log({ id: `${id}-p2`, ticketId: id, stage: 'REWORK', startedAt: at('2026-08-13T05:00:00Z'), endedAt: at('2026-08-13T05:05:00Z'), durationSeconds: 300 });
        }
      }
      // The only difference: repaired time on t-1, inside the current cycle.
      await log({
        id: 't-1-repaired', ticketId: 't-1', stage: rework ? 'REWORK' : 'WORK',
        startedAt: at(rework ? '2026-08-13T05:05:00Z' : '2026-08-13T04:10:00Z'),
        endedAt: at(rework ? '2026-08-13T05:20:00Z' : '2026-08-13T04:40:00Z'),
        durationSeconds: rework ? 900 : 1800, countsAsWork: false, pauseReason: REPAIR_PAUSE_REASON,
      });
    }

    const timers = async (id: string) => ledger.getTicketTimers(await prisma.ticket.findUnique({ where: { id } }));
    const budget = async (id: string) => {
      const t = await prisma.ticket.findUnique({ where: { id } });
      return (await ledger.getWorkBudgets([t]))!.get(id)!;
    };
    const productive = (x: any) => ({
      employeeWorkSeconds: x.employeeWorkSeconds,
      original: x.original,
      reworks: x.reworks,
      workBudget: x.workBudget,
      totalTicketSeconds: x.totalTicketSeconds,
      lifecycle: x.lifecycle,
      reviewerApprovalSeconds: x.reviewerApprovalSeconds,
      activeClock: x.activeClock,
    });

    it('original cycle: contributes nothing to work time, Time Left or lifecycle, and list/detail agree', async () => {
      await seedPair(false);
      const [withRepair, control] = [await timers('t-1'), await timers('t-2')];
      expect(withRepair.employeeWorkSeconds).toBe(600);
      expect(withRepair.original.actualSeconds).toBe(600);
      expect(withRepair.workBudget).toMatchObject({ cycle: 'ORIGINAL', workedSeconds: 600, remainingSeconds: 3000, running: false });
      expect(productive(withRepair)).toEqual(productive(control));

      const listBudget = await budget('t-1');
      const { pause: _p, ...fromList } = listBudget as any;
      expect(fromList).toEqual(withRepair.workBudget);
    });

    it('rework cycle: excluded from rework actual time, Time Left and frozen reworkWorkSeconds; normal rows still count', async () => {
      await seedPair(true);
      const [withRepair, control] = [await timers('t-1'), await timers('t-2')];
      expect(withRepair.original.actualSeconds).toBe(600);
      expect(withRepair.reworks).toEqual([expect.objectContaining({ cycleNo: 1, estimatedMinutes: 30, actualSeconds: 300, open: true })]);
      expect(withRepair.workBudget).toMatchObject({ cycle: 'REWORK', cycleNo: 1, workedSeconds: 300, remainingSeconds: 1500 });
      expect(withRepair.employeeWorkSeconds).toBe(900);
      expect(productive(withRepair)).toEqual(productive(control));
      const { pause: _p, ...fromList } = (await budget('t-1')) as any;
      expect(fromList).toEqual(withRepair.workBudget);

      // Freezing the rework cycle (rework → REVIEW) uses productive rows only.
      for (const id of ['t-1', 't-2']) await ledger.closeReworkSegment(id, at('2026-08-13T05:30:00Z'));
      const frozen = await prisma.reviewCycleLog.findMany({ where: { ticketId: { in: ['t-1', 't-2'] } }, orderBy: { ticketId: 'asc' } });
      expect(frozen.map((c) => c.reworkWorkSeconds)).toEqual([300, 300]);
      expect((await timers('t-1')).reworks[0]).toMatchObject({ actualSeconds: 300, open: false });

      // The next review cycle's frozen assignee work excludes it too.
      for (const id of ['t-1', 't-2']) {
        await ledger.startReviewCycle({ ticketId: id, assigneeId: W, reviewStartedAt: at('2026-08-13T05:30:00Z') });
        await ledger.endReviewCycle({ ticketId: id, decision: 'APPROVED', reviewEndedAt: at('2026-08-13T05:50:00Z') });
      }
      const reviewed = await prisma.reviewCycleLog.findMany({ where: { cycleNo: 2 }, orderBy: { ticketId: 'asc' } });
      expect(reviewed.map((c) => c.assigneeWorkSeconds)).toEqual([300, 300]);
    });
  });

  // ── Migration and index ────────────────────────────────────────────────────

  describe('one-active-timer migration and index', () => {
    it('refuses to create the index while duplicates exist, and changes nothing', async () => {
      await seedMess();
      const before = await fingerprint();
      await expect(applyOneActiveMigration(prisma)).rejects.toThrow(/more than one active ASSIGNEE timer/);
      expect((await oneActiveIndexState(prisma)).exists).toBe(false);
      expect(await fingerprint()).toEqual(before);
    });

    it('succeeds after the cleanup, with the exact partial definition', async () => {
      await seedMess();
      await runCleanupApply(prisma as any, opts());
      await applyOneActiveMigration(prisma);
      const state = await oneActiveIndexState(prisma);
      expect(state.exists && state.valid).toBe(true);
      expect(state.definition).toBe(
        `CREATE UNIQUE INDEX ${ONE_ACTIVE_INDEX} ON public.ticket_time_logs USING btree ("userId") ` +
          `WHERE (("endedAt" IS NULL) AND ("ownerType" = 'ASSIGNEE'::text))`,
      );
    });

    it('rejects a second active ASSIGNEE timer and allows everything the engine legitimately writes', async () => {
      await applyOneActiveMigration(prisma);
      await log({ id: 'l-1', ticketId: 't-1', startedAt: at('2026-08-13T05:00:00Z'), workSessionId: 's-today' });

      await expect(log({ id: 'l-second', ticketId: 't-2', startedAt: at('2026-08-13T05:30:00Z') })).rejects.toMatchObject({ code: 'P2002' });

      // Ended rows, zero-length markers, reviewer/manager timers and another user's timer are all fine.
      await log({ id: 'l-ended-1', ticketId: 't-2', startedAt: at('2026-08-13T04:00:00Z'), endedAt: at('2026-08-13T04:10:00Z'), durationSeconds: 600 });
      await log({ id: 'l-ended-2', ticketId: 't-2', startedAt: at('2026-08-13T04:20:00Z'), endedAt: at('2026-08-13T04:20:00Z'), durationSeconds: 0, countsAsWork: false, pauseReason: 'AWAITING_WORKDAY' });
      await log({ id: 'l-rev-1', ticketId: 't-3', ownerType: 'REVIEWER', stage: 'REVIEW', startedAt: at('2026-08-13T05:00:00Z') });
      await log({ id: 'l-rev-2', ticketId: 't-2', ownerType: 'REVIEWER', stage: 'REVIEW', startedAt: at('2026-08-13T05:00:00Z') });
      await log({ id: 'l-mgr', ticketId: 't-2', ownerType: 'MANAGER', stage: 'WORK', startedAt: at('2026-08-13T05:00:00Z') });
      await log({ id: 'l-other-user', ticketId: 't-5', userId: W2, startedAt: at('2026-08-13T05:00:00Z') });

      expect((await activeAssignee(W)).map((l) => l.id)).toEqual(['l-1']);
      expect((await activeAssignee(W2)).map((l) => l.id)).toEqual(['l-other-user']);
    });
  });

  // ── Concurrency with the index in place ───────────────────────────────────

  describe('concurrency', () => {
    beforeEach(async () => {
      await applyOneActiveMigration(prisma);
    });

    it('two simultaneous starts for one worker leave exactly one active timer', async () => {
      const results = await Promise.all([
        ledger.startAssigneeTimer({ ticketId: 't-1', workerId: W, mode: 'START', source: 'TICKET_STATUS' }),
        ledger.startAssigneeTimer({ ticketId: 't-2', workerId: W, mode: 'START', source: 'TICKET_STATUS' }),
      ]);
      expect(results.map((r) => r.outcome).sort()).toEqual(['STARTED', 'STARTED']);
      const active = await activeAssignee(W);
      expect(active).toHaveLength(1);
      const all = await prisma.ticketTimeLog.findMany({ where: { userId: W, ticketId: { in: ['t-1', 't-2'] }, startedAt: { gt: at('2026-09-01T00:00:00Z') } } });
      expect(all).toHaveLength(2); // the loser's segment was closed, not left half-written
      expect(all.filter((l) => l.endedAt).map((l) => l.pauseReason)).toEqual(['SWITCHED']);
    });

    it('two raw inserts that bypass the ledger lock cannot both commit', async () => {
      const insert = (id: string, ticketId: string) =>
        prisma.$transaction(async (tx) => {
          await tx.ticketTimeLog.create({
            data: { id, ticketId, userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', startedAt: at('2026-08-13T05:00:00Z') } as any,
          });
          await sleep(300);
        });
      const settled = await Promise.allSettled([insert('l-race-a', 't-1'), insert('l-race-b', 't-2')]);
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((s) => s.status === 'rejected').map((s: any) => s.reason.code)).toEqual(['P2002']);
      expect(await activeAssignee(W)).toHaveLength(1);
    });

    it('a start that loses a race to an unlocked writer retries, switches, and never leaks a database error', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.ticketTimeLog.create({
            data: { id: 'l-unlocked', ticketId: 't-2', userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', startedAt: at('2026-08-13T05:00:00Z'), workSessionId: 's-today' } as any,
          });
          await gate;
        },
        { timeout: 30_000 },
      );
      await sleep(300); // the uncommitted row now holds the index entry
      const start = ledger.startAssigneeTimer({ ticketId: 't-1', workerId: W, mode: 'START', source: 'TICKET_STATUS' });
      await sleep(700); // the start is now waiting on the index
      release();
      await holder;

      const result = await start;
      expect(result.outcome).toBe('STARTED');
      const active = await activeAssignee(W);
      expect(active.map((l) => l.ticketId)).toEqual(['t-1']);
      const loser = await prisma.ticketTimeLog.findUnique({ where: { id: 'l-unlocked' } });
      expect(loser!.endedAt).not.toBeNull();
      expect(loser!.pauseReason).toBe('SWITCHED');
    });

    it('the unlocked legacy start path reports a conflict, not a raw error, and writes nothing', async () => {
      await ledger.startAssigneeTimer({ ticketId: 't-1', workerId: W, mode: 'START', source: 'TICKET_STATUS' });
      const before = await fingerprint(['ticket_time_logs']);
      await expect(
        ledger.startWorkLog({ ticketId: 't-2', userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await fingerprint(['ticket_time_logs'])).toEqual(before);
      expect(await activeAssignee(W)).toHaveLength(1);
    });
  });

  // ── CLI ────────────────────────────────────────────────────────────────────

  describe('CLI', () => {
    const SECRET = 'Sup3r-Secret-Pa55';
    const cwd = path.resolve(__dirname, '../..');
    const tsNode = require.resolve('ts-node/dist/bin.js', { paths: [cwd] });
    const DB = 'apex_os_attendance_integration';

    const run = (env: Record<string, string | undefined>, args: string[] = []) => {
      const childEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries({ ...process.env, ...env })) if (v !== undefined) childEnv[k] = v;
      if (env.DATABASE_URL === undefined) delete childEnv.DATABASE_URL;
      const r = spawnSync(process.execPath, [tsNode, '--transpile-only', 'scripts/ticket-time-cleanup.ts', ...args], {
        cwd, env: childEnv, encoding: 'utf8', timeout: 90_000,
      });
      return { code: r.status, out: `${r.stdout}\n${r.stderr}`, stdout: r.stdout };
    };
    const good = () => process.env.DATABASE_URL as string;
    const now = `--now=${REPAIR_AT.toISOString()}`;

    it('dry run exits 2 with changes, apply exits 0, then the dry run exits 0', async () => {
      await seedMess();
      const before = await fingerprint();
      const dry = run({ DATABASE_URL: good() }, ['--json', now]);
      expect(dry.code).toBe(2);
      expect(JSON.parse(dry.stdout).result).toBe('CHANGES_REQUIRED');
      expect(await fingerprint()).toEqual(before);

      const apply = run({ DATABASE_URL: good() }, ['--apply', `--confirm-database=${DB}`, now]);
      expect(apply.code).toBe(0);
      expect(apply.out).toContain('Ticket timer cleanup (apply): APPLIED');

      const after = run({ DATABASE_URL: good() }, [now]);
      expect(after.code).toBe(0);
      expect(after.out).toContain('CLEAN');
    });

    it.each([
      ['--apply without confirmation', ['--apply']],
      ['--apply with the wrong database', ['--apply', '--confirm-database=apex_db_dugl']],
      ['--fix', ['--fix']],
      ['--repair', ['--repair']],
    ])('exits 1 and changes nothing for %s', async (_label, args) => {
      await seedMess();
      const before = await fingerprint();
      const r = run({ DATABASE_URL: good() }, args);
      expect(r.code).toBe(1);
      expect(r.out).toContain('ticket-time cleanup refused');
      expect(await fingerprint()).toEqual(before);
    });

    it.each([
      ['missing', undefined],
      ['wrong database name', `postgresql://apex_test:${SECRET}@127.0.0.1:55432/apex_os_render_clone_20260928`],
      ['remote host', `postgresql://apex_test:${SECRET}@10.20.30.40:5432/${DB}`],
      ['Render host', `postgresql://apex_test:${SECRET}@dpg-x.oregon-postgres.render.com/${DB}`],
      ['malformed', `postgres//apex_test:${SECRET}@@`],
    ])('exits 1 and refuses a %s URL, even with --apply, without printing the password', (_label, url) => {
      const r = run({ DATABASE_URL: url }, ['--apply', `--confirm-database=${DB}`]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('ticket-time cleanup refused');
      expect(r.out).not.toContain(SECRET);
    });

    it('exits 1 on a connection failure without printing the password', () => {
      const unreachable = good().replace('://apex_test@', `://apex_test:${SECRET}@`).replace(/:\d+\//, ':1/');
      const r = run({ DATABASE_URL: unreachable });
      expect(r.code).toBe(1);
      expect(r.out).not.toContain(SECRET);
    });
  });
});
