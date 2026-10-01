import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TVAService } from '../../../common/services/tva.service';

export const LEDGER_STAGES = {
  WORK: 'WORK',
  REVIEW: 'REVIEW',
  REWORK: 'REWORK',
  MEETING: 'MEETING',
  BLOCKED: 'BLOCKED',
};

export const LEDGER_OWNER_TYPES = {
  ASSIGNEE: 'ASSIGNEE',
  REVIEWER: 'REVIEWER',
  MANAGER: 'MANAGER',
  TEAM_LEAD: 'TEAM_LEAD',
  SYSTEM: 'SYSTEM',
};

export const LEDGER_SOURCES = {
  SYSTEM: 'SYSTEM',
  WORKDAY: 'WORKDAY',
  TICKET_STATUS: 'TICKET_STATUS',
  MANUAL: 'MANUAL',
};

export const LEDGER_PAUSE_REASONS = {
  BREAK: 'BREAK',
  LOGOUT: 'LOGOUT',
  BLOCKED: 'BLOCKED',
  CLOSED: 'CLOSED',
  SYSTEM: 'SYSTEM',
  UNASSIGNED: 'UNASSIGNED',
  // A normal ticket status transition out of IN_PROGRESS (e.g. submitted for
  // review, marked done) — distinct from BREAK/LOGOUT/SYSTEM, which are workday
  // interruptions rather than the worker actually finishing/handing off the work.
  STATUS_CHANGE: 'STATUS_CHANGE',
  // The worker started another ticket; one timed ticket per worker at a time.
  SWITCHED: 'SWITCHED',
  // Zero-length marker: the ticket was started for a worker who had no open
  // working session. The next workday start resumes it (see
  // resumeAfterWorkdayStart). Never counts any time.
  AWAITING_WORKDAY: 'AWAITING_WORKDAY',
  // Workday closure reasons written by the scheduler's finalizer.
  POLICY_AUTO_STOP: 'POLICY_AUTO_STOP',
  AUTO_LOGOUT: 'AUTO_LOGOUT',
  // The worker went idle; the segment ends when the idle period began, so idle
  // time is never counted. Resuming work picks the ticket back up.
  IDLE: 'IDLE',
  // Written only by the Phase 2D1 ticket-time cleanup, which closes an invalid
  // or duplicate active timer with countsAsWork = false. A deliberate stop:
  // never auto-resumed.
  INTEGRITY_REPAIR: 'INTEGRITY_REPAIR',
};

// A segment that ended for one of these reasons was interrupted by the worker's
// day (break, end day, punch out, auto-close), not by anything done to the
// ticket, so the next workday start may pick it back up. STATUS_CHANGE,
// SWITCHED, BLOCKED, UNASSIGNED and CLOSED are deliberate stops and never
// auto-resume.
export const WORKDAY_RESUMABLE_PAUSE_REASONS: string[] = [
  LEDGER_PAUSE_REASONS.LOGOUT,
  LEDGER_PAUSE_REASONS.SYSTEM,
  LEDGER_PAUSE_REASONS.POLICY_AUTO_STOP,
  LEDGER_PAUSE_REASONS.AUTO_LOGOUT,
  LEDGER_PAUSE_REASONS.AWAITING_WORKDAY,
  LEDGER_PAUSE_REASONS.BREAK,
  LEDGER_PAUSE_REASONS.IDLE,
];

// How startAssigneeTimer treats the worker's other active ticket and an
// unavailable worker:
//   START   explicit start (status → IN_PROGRESS, reassignment). Pauses any
//           other active ticket (SWITCHED); if the worker is not working, writes
//           a zero-length marker so a later break end / workday start resumes it.
//   UNBLOCK never pauses another ticket; if the worker is not working, writes a
//           marker only when this ticket was the worker's latest segment.
//   RESUME  break end / workday start. Never pauses another ticket, never
//           writes a marker.
//   HANDOVER reassignment of an IN_PROGRESS ticket. Never pauses the new
//           assignee's current ticket; if they are on break or off shift,
//           writes a marker (so their own break end / workday start picks it
//           up) unless they already have paused work of their own waiting.
export type AssigneeTimerMode = 'START' | 'UNBLOCK' | 'RESUME' | 'HANDOVER';

export type AssigneeTimerOutcome =
  | 'STARTED'
  | 'ALREADY_ACTIVE'
  | 'DEFERRED'
  | 'INELIGIBLE'
  | 'OTHER_ACTIVE'
  | 'WORKER_UNAVAILABLE';

// Only an actively working assignee runs a ticket clock. IDLE, ON_BREAK and
// closed sessions never do.
const WORKING_SESSION_STATUSES = ['WORKING'];

/**
 * Live segments that belong to one work session. Closing a session must only
 * close its own segments, never one already running in the user's newer
 * session; session-less legacy segments count when they started before the close.
 */
export function ticketLogSessionScope(workSessionId: string, endedAt?: Date): Prisma.TicketTimeLogWhereInput {
  return {
    OR: [
      { workSessionId },
      { workSessionId: null, ...(endedAt ? { startedAt: { lte: endedAt } } : {}) },
    ],
  };
}

/**
 * The ledger's canonical productive-time test. Only rows with countsAsWork =
 * true add to employee work, cycle actuals, the work budget (Time Left) and
 * frozen rework seconds. Zero-length pause markers and rows closed by the
 * Phase 2D1 cleanup (INTEGRITY_REPAIR) are countsAsWork = false.
 */
export function isProductiveLog(l: { countsAsWork?: boolean | null }): boolean {
  return l.countsAsWork === true;
}

export const ONE_ACTIVE_TIMER_CONFLICT =
  'Another timer for this worker started at the same moment. Please try again.';

export const ONE_ACTIVE_TIMER_INDEX = 'ticket_time_logs_one_active_assignee_per_user';

/**
 * True when `err` is the database refusing a second active ASSIGNEE timer for
 * one user (the Phase 2D1 partial unique index), however Prisma surfaced it.
 */
export function isOneActiveTimerViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string; meta?: Record<string, unknown> } | null;
  if (!e) return false;
  const text = `${e.message ?? ''} ${JSON.stringify(e.meta ?? {})}`;
  if (text.includes(ONE_ACTIVE_TIMER_INDEX)) return true;
  if (e.code !== 'P2002') return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target : [target];
  return (e.meta?.modelName === undefined || e.meta?.modelName === 'TicketTimeLog') && fields.includes('userId');
}

@Injectable()
export class TicketLedgerService {
  constructor(
    private prisma: PrismaService,
    private tva: TVAService,
  ) {}

  async getActiveLogForUser(userId: string) {
    return this.prisma.ticketTimeLog.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Read model for a ticket's clocks. Everything comes from TicketTimeLog and
   * ReviewCycleLog; nothing is inferred from updatedAt or the SLA fields.
   *
   *   lifecycle          first IN_PROGRESS (actualStartAt) → DONE. CLOSED is a
   *                      cancellation and is reported as such, not as DONE.
   *   employee work      productive ASSIGNEE ledger time only: breaks, end-day,
   *                      overnight, blocked and switched-away time never count.
   *   original / rework  the original cycle is compared against
   *                      Ticket.estimatedMinutes; each rework cycle against its
   *                      own ReviewCycleLog.reworkEstimatedMinutes.
   *   review             wall-clock time in REVIEW, a separate clock. No
   *                      reviewer or manager timer exists.
   *
   * totalTicketSeconds / employeeWorkSeconds / reviewerApprovalSeconds /
   * activeClock keep the names the ticket page already reads.
   */
  async getTicketTimers(ticket: any) {
    const now = this.tva.now();
    const [logs, cycles] = await Promise.all([
      this.prisma.ticketTimeLog.findMany({
        where: { ticketId: ticket.id, ownerType: LEDGER_OWNER_TYPES.ASSIGNEE },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.reviewCycleLog.findMany({
        where: { ticketId: ticket.id },
        orderBy: { cycleNo: 'asc' },
      }),
    ]);

    const logSeconds = (l: any) =>
      l.endedAt ? (l.durationSeconds ?? 0) : this.tva.elapsedSeconds(l.startedAt, now);
    // Productive time only: rows the ledger marks countsAsWork = false (pause
    // markers, INTEGRITY_REPAIR closures) never count. Lifecycle, review time
    // and activeClock still read every row.
    const productive = logs.filter(isProductiveLog);
    const sumWindow = (from: Date | null, to: Date | null) =>
      productive
        .filter((l: any) =>
          (!from || l.startedAt.getTime() >= from.getTime()) &&
          (!to || l.startedAt.getTime() < to.getTime()))
        .reduce((acc: number, l: any) => acc + logSeconds(l), 0);

    const reworkCycles = cycles.filter((c: any) => c.decision === 'REWORK' && c.reworkStartedAt);
    const firstReworkStart: Date | null = reworkCycles[0]?.reworkStartedAt ?? null;

    const originalWorkSeconds = sumWindow(null, firstReworkStart);
    const reworks = reworkCycles.map((c: any, i: number) => {
      const next = reworkCycles[i + 1]?.reworkStartedAt ?? null;
      const open = !c.reworkEndedAt;
      const actualSeconds = !open && c.reworkWorkSeconds != null
        ? c.reworkWorkSeconds
        : sumWindow(c.reworkStartedAt, c.reworkEndedAt ?? next);
      return {
        cycleNo: c.cycleNo,
        reworkStartedAt: c.reworkStartedAt,
        reworkEndedAt: c.reworkEndedAt ?? null,
        estimatedMinutes: c.reworkEstimatedMinutes ?? null,
        actualSeconds,
        open,
      };
    });

    const employeeWorkSeconds = productive.reduce((acc: number, l: any) => acc + logSeconds(l), 0);

    let reviewSeconds = 0;
    for (const c of cycles as any[]) {
      if (c.reviewStartedAt && c.reviewEndedAt) {
        reviewSeconds += this.tva.elapsedSeconds(c.reviewStartedAt, c.reviewEndedAt);
      }
    }
    const inReview = ticket.status === 'REVIEW' && ticket.reviewStartedAt;
    if (inReview) reviewSeconds += this.tva.elapsedSeconds(ticket.reviewStartedAt, now);

    const lifecycleStartedAt: Date | null = ticket.actualStartAt ?? logs[0]?.startedAt ?? null;
    let lifecycleEndedAt: Date | null = null;
    let lifecycleEndState: 'DONE' | 'CLOSED' | null = null;
    if (ticket.status === 'DONE') {
      lifecycleEndedAt = ticket.actualCompletedAt ?? ticket.resolvedAt ?? null;
      lifecycleEndState = 'DONE';
    } else if (ticket.status === 'CLOSED') {
      lifecycleEndedAt = ticket.cancelledAt ?? ticket.closedAt ?? null;
      lifecycleEndState = 'CLOSED';
    }
    const lifecycleSeconds = lifecycleStartedAt
      ? this.tva.elapsedSeconds(lifecycleStartedAt, lifecycleEndedAt ?? now)
      : 0;

    const active = logs.find((l: any) => !l.endedAt) ?? null;
    const activeClock = active ? 'EMPLOYEE_WORK' : inReview ? 'REVIEWER_APPROVAL' : 'NONE';
    const pause = active ? null : (await this.getPauseStates([ticket])).get(ticket.id) ?? null;

    return {
      pause,
      totalTicketSeconds: lifecycleSeconds,
      employeeWorkSeconds,
      reviewerApprovalSeconds: reviewSeconds,
      activeClock,
      active: active
        ? { userId: active.userId, stage: active.stage, startedAt: active.startedAt }
        : null,
      lifecycle: {
        startedAt: lifecycleStartedAt,
        endedAt: lifecycleEndedAt,
        endState: lifecycleEndState,
        seconds: lifecycleSeconds,
      },
      original: {
        estimatedMinutes: ticket.estimatedMinutes ?? null,
        actualSeconds: originalWorkSeconds,
      },
      reworks,
      workBudget: this.buildWorkBudget(ticket, logs, cycles, now),
    };
  }

  /**
   * Work budget for the ticket's current execution cycle: its estimate minus
   * the assignee's productive ledger time in that cycle. This is what "Time
   * left" means everywhere a ticket is shown. It is not the SLA deadline
   * (TicketTimingService), which is a separate, wall-clock clock.
   *
   *   current cycle   the open rework cycle if there is one (its own
   *                   reworkEstimatedMinutes), otherwise the original cycle
   *                   (Ticket.estimatedMinutes)
   *   running         the assignee's clock is running right now; the client
   *                   may count remainingSeconds down from `asOf` only then
   */
  private buildWorkBudget(ticket: any, logs: any[], cycles: any[], now: Date) {
    const logSeconds = (l: any) =>
      l.endedAt ? (l.durationSeconds ?? 0) : this.tva.elapsedSeconds(l.startedAt, now);
    const reworkCycles = cycles
      .filter((c: any) => c.decision === 'REWORK' && c.reworkStartedAt)
      .sort((a: any, b: any) => a.cycleNo - b.cycleNo);
    const openRework = [...reworkCycles].reverse().find((c: any) => !c.reworkEndedAt) ?? null;
    const firstReworkStart: Date | null = reworkCycles[0]?.reworkStartedAt ?? null;

    const inCycle = openRework
      ? (l: any) => l.startedAt.getTime() >= openRework.reworkStartedAt.getTime()
      : (l: any) => !firstReworkStart || l.startedAt.getTime() < firstReworkStart.getTime();
    const workedSeconds = logs
      .filter((l: any) => isProductiveLog(l) && inCycle(l))
      .reduce((acc: number, l: any) => acc + logSeconds(l), 0);
    const estimatedMinutes: number | null = openRework
      ? openRework.reworkEstimatedMinutes ?? null
      : ticket.estimatedMinutes ?? null;

    return {
      cycle: openRework ? ('REWORK' as const) : ('ORIGINAL' as const),
      cycleNo: openRework?.cycleNo ?? null,
      estimatedMinutes,
      workedSeconds,
      remainingSeconds: estimatedMinutes ? estimatedMinutes * 60 - workedSeconds : null,
      running: logs.some((l: any) => !l.endedAt),
      asOf: now,
    };
  }

  /**
   * Why an IN_PROGRESS ticket's clock is not running, from the assignee's live
   * state (not from the stored pauseReason, which only records what closed the
   * last segment). Batched for list screens: three queries for any page size.
   *   BLOCKED           the ticket is blocked
   *   WORKING_ON_OTHER  the assignee's clock is running on another ticket
   *   ON_BREAK / IDLE   the assignee's session state
   *   PUNCHED_OUT       the assignee has no open workday
   *   WAITING           working, nothing running (the queue will start one)
   * Tickets whose clock is running, or that are not IN_PROGRESS, get no entry.
   */
  async getPauseStates(tickets: any[]) {
    type PauseState = {
      reason: 'BLOCKED' | 'WORKING_ON_OTHER' | 'ON_BREAK' | 'IDLE' | 'PUNCHED_OUT' | 'WAITING';
      since: Date | null;
      otherTicketId?: string;
      otherTicketKey?: string;
    };
    const result = new Map<string, PauseState>();
    const eligible = tickets.filter((t) => t?.id && t.status === 'IN_PROGRESS' && t.assignedToId);
    if (eligible.length === 0) return result;

    const workerIds = [...new Set(eligible.map((t) => t.assignedToId as string))];
    const [activeLogs, sessions, lastEnded] = await Promise.all([
      this.prisma.ticketTimeLog.findMany({
        where: { userId: { in: workerIds }, endedAt: null },
        select: { userId: true, ticketId: true, ticket: { select: { ticketId: true } } },
      }),
      this.prisma.workSession.findMany({
        where: { userId: { in: workerIds } },
        orderBy: { createdAt: 'desc' },
        distinct: ['userId'],
        select: { userId: true, status: true, logoutAt: true },
      }),
      this.prisma.ticketTimeLog.groupBy({
        by: ['ticketId'],
        where: { ticketId: { in: eligible.map((t) => t.id) }, ownerType: LEDGER_OWNER_TYPES.ASSIGNEE, endedAt: { not: null } },
        _max: { endedAt: true },
      }),
    ]);
    const activeBy = new Map(activeLogs.map((l: any) => [l.userId, l]));
    const sessionBy = new Map(sessions.map((s: any) => [s.userId, s]));
    const sinceBy = new Map(lastEnded.map((r: any) => [r.ticketId, r._max.endedAt ?? null]));

    for (const t of eligible) {
      const active: any = activeBy.get(t.assignedToId);
      if (active?.ticketId === t.id) continue; // running
      const since = sinceBy.get(t.id) ?? null;
      if (t.isBlocked) { result.set(t.id, { reason: 'BLOCKED', since }); continue; }
      if (active) {
        result.set(t.id, { reason: 'WORKING_ON_OTHER', since, otherTicketId: active.ticketId, otherTicketKey: active.ticket?.ticketId });
        continue;
      }
      const s: any = sessionBy.get(t.assignedToId);
      const closed = !s || !!s.logoutAt || ['LOGGED_OUT', 'AUTO_CLOSED'].includes(s.status);
      const reason = closed ? 'PUNCHED_OUT'
        : s.status === 'ON_BREAK' ? 'ON_BREAK'
        : s.status === 'IDLE' ? 'IDLE'
        : s.status === 'WORKING' ? 'WAITING'
        : 'PUNCHED_OUT';
      result.set(t.id, { reason, since });
    }
    return result;
  }

  /**
   * Batch form of the work budget for list screens (ticket list, Kanban): two
   * queries for the whole page instead of two per ticket.
   */
  async getWorkBudgets(tickets: any[]) {
    type Budget = ReturnType<TicketLedgerService['buildWorkBudget']> & {
      pause: Awaited<ReturnType<TicketLedgerService['getPauseStates']>> extends Map<string, infer P> ? P | null : never;
    };
    const result = new Map<string, Budget>();
    const ids = tickets.map((t) => t?.id).filter(Boolean);
    if (ids.length === 0) return result;
    const now = this.tva.now();
    const [logs, cycles] = await Promise.all([
      this.prisma.ticketTimeLog.findMany({
        where: { ticketId: { in: ids }, ownerType: LEDGER_OWNER_TYPES.ASSIGNEE },
        select: { ticketId: true, startedAt: true, endedAt: true, durationSeconds: true, countsAsWork: true },
      }),
      this.prisma.reviewCycleLog.findMany({
        where: { ticketId: { in: ids }, decision: 'REWORK', reworkStartedAt: { not: null } },
        select: { ticketId: true, cycleNo: true, decision: true, reworkStartedAt: true, reworkEndedAt: true, reworkEstimatedMinutes: true },
      }),
    ]);
    const logsBy = new Map<string, any[]>();
    for (const l of logs) (logsBy.get(l.ticketId) ?? logsBy.set(l.ticketId, []).get(l.ticketId)!).push(l);
    const cyclesBy = new Map<string, any[]>();
    for (const c of cycles) (cyclesBy.get(c.ticketId) ?? cyclesBy.set(c.ticketId, []).get(c.ticketId)!).push(c);
    // Why a waiting ticket is not running, for the list / Kanban tooltip.
    const pauses = await this.getPauseStates(tickets);
    for (const t of tickets) {
      if (!t?.id) continue;
      result.set(t.id, {
        ...this.buildWorkBudget(t, logsBy.get(t.id) ?? [], cyclesBy.get(t.id) ?? [], now),
        pause: pauses.get(t.id) ?? null,
      });
    }
    return result;
  }

  async getActiveLogForTicket(ticketId: string) {
    return this.prisma.ticketTimeLog.findFirst({
      where: { ticketId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  }

  // Low-level, unlocked, actor-agnostic log start. Kept for compatibility;
  // production timer starts go through startAssigneeTimer().
  async startWorkLog(input: {
    ticketId: string;
    userId: string;
    stage: string;
    ownerType: string;
    source: string;
    workSessionId?: string;
    countsAsWork?: boolean;
  }) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) throw new BadRequestException('Ticket not found');
    if (ticket.status === 'CLOSED') throw new BadRequestException('Cannot start timer for a CLOSED ticket');

    const existing = await this.prisma.ticketTimeLog.findFirst({
      where: { ticketId: input.ticketId, userId: input.userId, stage: input.stage, endedAt: null },
    });

    if (existing) return existing;

    try {
      return await this.prisma.ticketTimeLog.create({
        data: {
          ticketId: input.ticketId,
          userId: input.userId,
          stage: input.stage,
          ownerType: input.ownerType,
          source: input.source,
          workSessionId: input.workSessionId,
          countsAsWork: input.countsAsWork ?? true,
          startedAt: this.tva.now(),
        },
      });
    } catch (err) {
      // Unlocked legacy path: the database's one-active-timer index is the
      // backstop. Report it as a conflict, never as a raw database error.
      if (isOneActiveTimerViolation(err)) {
        throw new ConflictException('This worker already has an active ticket timer.');
      }
      throw err;
    }
  }

  async endActiveLog(input: {
    logId?: string;
    ticketId?: string;
    userId?: string;
    pauseReason?: string;
    breakLogId?: string;
    endedAt?: Date;
  }) {
    let log;
    if (input.logId) {
      log = await this.prisma.ticketTimeLog.findUnique({ where: { id: input.logId } });
    } else if (input.ticketId && input.userId) {
      log = await this.prisma.ticketTimeLog.findFirst({
        where: { ticketId: input.ticketId, userId: input.userId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
    }

    if (!log || log.endedAt) return log;

    const endedAt = input.endedAt ?? this.tva.now();
    const durationSeconds = this.tva.elapsedSeconds(log.startedAt, endedAt);

    return this.prisma.ticketTimeLog.update({
      where: { id: log.id },
      data: {
        endedAt,
        durationSeconds,
        pauseReason: input.pauseReason,
        breakLogId: input.breakLogId,
      },
    });
  }

  /**
   * Serialises every timer start/pause for one worker. Transaction-scoped, so
   * it is released on commit/rollback and can never leak. Two tabs, a retry, a
   * manager and the worker starting tickets at the same moment, or a punch-out
   * racing a start all queue here instead of each writing an active log.
   */
  /**
   * Runs `fn` in the caller's transaction when one is given, so the ledger
   * change commits or rolls back with the caller's business change; otherwise
   * in a transaction of its own. Never nests an independent transaction.
   */
  private inTransaction<T>(
    tx: Prisma.TransactionClient | undefined,
    fn: (client: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx ? fn(tx) : this.prisma.$transaction(fn);
  }

  private async lockWorkerTimers(tx: Prisma.TransactionClient, userId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ticket-timer:' + userId}))`;
  }

  private async closeLog(
    tx: Prisma.TransactionClient,
    log: { id: string; startedAt: Date },
    endedAt: Date,
    pauseReason: string,
    breakLogId?: string,
  ) {
    return tx.ticketTimeLog.update({
      where: { id: log.id },
      data: {
        endedAt,
        durationSeconds: this.tva.elapsedSeconds(log.startedAt, endedAt),
        pauseReason,
        breakLogId,
      },
    });
  }

  // Optional `tx` lets callers (e.g. WorkdayService.finalizeWorkSession) run this
  // inside their own Prisma transaction; omitted, it runs in its own. Either way
  // it takes the worker's timer lock so it cannot interleave with a start.
  async pauseActiveLogsForUser(
    input: {
      userId: string;
      pauseReason: string;
      breakLogId?: string;
      endedAt?: Date;
      // Closing one work session must only close that session's segments, never
      // a segment already running in the user's newer session (a previous day
      // closed late by the scheduler). Session-less legacy segments count when
      // they started before the close.
      workSessionId?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const run = async (client: Prisma.TransactionClient) => {
      await this.lockWorkerTimers(client, input.userId);
      const activeLogs = await client.ticketTimeLog.findMany({
        where: {
          userId: input.userId,
          endedAt: null,
          ...(input.workSessionId ? ticketLogSessionScope(input.workSessionId, input.endedAt) : {}),
        },
      });

      if (activeLogs.length === 0) return { count: 0, logIds: [] as string[] };

      const endedAt = input.endedAt ?? this.tva.now();
      const logIds: string[] = [];
      for (const log of activeLogs) {
        // A back-dated pause (idle began earlier) never ends a segment before it started.
        const end = endedAt.getTime() < log.startedAt.getTime() ? log.startedAt : endedAt;
        await this.closeLog(client, log, end, input.pauseReason, input.breakLogId);
        logIds.push(log.id);
      }
      return { count: logIds.length, logIds };
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * Stops every active log on a ticket, whoever holds it. Used when the ticket
   * itself stops being workable (leaves IN_PROGRESS, is blocked, is handed to
   * someone else): the actor is irrelevant, the clock belongs to the ticket's
   * worker and must not survive the transition.
   *
   * Lock first, then read. The caller names the workers who could be starting
   * this ticket's clock right now (the primary assignee before and after the
   * change); they are timer-locked even when nothing is running yet, together
   * with any holder already on the ticket (including a corrupt row owned by
   * someone unexpected). These initially known workers are de-duplicated and
   * locked in sorted order. Only then are the active rows re-read and closed.
   * A start that won the race has therefore committed and is seen here; one
   * that lost waits on the lock and re-reads a ticket that is no longer
   * workable. The caller has already written the ticket row, so the order is
   * always ticket row, then worker locks.
   *
   * If a writer that bypassed the ledger introduces an unexpected holder after
   * that, each newly discovered batch is sorted and locked in turn; there is no
   * single global order across those discovery rounds. Normal production timer
   * paths only ever involve the expected workers, so they stay serialized.
   */
  async endActiveLogsForTicket(
    ticketId: string,
    pauseReason: string,
    endedAt?: Date,
    tx?: Prisma.TransactionClient,
    workerIds: Array<string | null | undefined> = [],
  ) {
    return this.inTransaction(tx, async (client) => {
      const locked = new Set<string>();
      const lockAll = async (ids: Iterable<string>) => {
        for (const userId of [...new Set(ids)].filter((id) => !locked.has(id)).sort()) {
          await this.lockWorkerTimers(client, userId);
          locked.add(userId);
        }
      };

      const holders = await client.ticketTimeLog.findMany({
        where: { ticketId, endedAt: null },
        select: { userId: true },
      });
      await lockAll([
        ...workerIds.filter((id): id is string => Boolean(id)),
        ...holders.map((h) => h.userId),
      ]);

      // Re-read under the locks. A holder that appeared meanwhile outside the
      // locked set can only be a writer that bypassed the ledger: lock that
      // batch too (sorted within the batch) and read again, so even a corrupt
      // row is closed rather than missed.
      let active = await client.ticketTimeLog.findMany({ where: { ticketId, endedAt: null } });
      while (active.some((l) => !locked.has(l.userId))) {
        await lockAll(active.map((l) => l.userId));
        active = await client.ticketTimeLog.findMany({ where: { ticketId, endedAt: null } });
      }

      const at = endedAt ?? this.tva.now();
      const logIds: string[] = [];
      for (const log of active) {
        await this.closeLog(client, log, at, pauseReason);
        logIds.push(log.id);
      }
      const userIds = [...new Set(active.map((l) => l.userId))].sort();
      return { count: logIds.length, logIds, userIds };
    });
  }

  /**
   * There is no manual pause or resume: an assignee's IN_PROGRESS, unblocked
   * tickets are either running (at most one) or waiting, and the system moves
   * between them. When nothing is running for a WORKING assignee, the waiting
   * ticket they were most recently on starts; tickets never timed yet follow,
   * newest first. REVIEW / DONE / blocked / other people's tickets never start.
   *
   * No-op unless the worker is WORKING with no active log. Each attempt goes
   * through startAssigneeTimer (RESUME), which re-checks everything under the
   * worker's lock, so a race can only make it do less, never overlap.
   */
  async resumeNextWaitingTicket(workerId: string, excludeTicketId?: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const active = await db.ticketTimeLog.findFirst({ where: { userId: workerId, endedAt: null }, select: { id: true } });
    const session = await db.workSession.findFirst({
      where: { userId: workerId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, logoutAt: true },
    });
    if (active || !session || session.logoutAt || !WORKING_SESSION_STATUSES.includes(session.status)) {
      return { outcome: 'NOTHING_TO_DO' as const };
    }

    const waiting = await db.ticket.findMany({
      where: {
        assignedToId: workerId,
        status: 'IN_PROGRESS',
        isBlocked: false,
        ...(excludeTicketId ? { id: { not: excludeTicketId } } : {}),
      },
      select: { id: true, updatedAt: true },
      orderBy: { id: 'asc' }, // stable input, so exact endedAt/updatedAt ties resolve the same way every time
    });
    if (waiting.length === 0) return { outcome: 'NOTHING_TO_DO' as const };

    const lastEnded = await db.ticketTimeLog.groupBy({
      by: ['ticketId'],
      where: {
        userId: workerId,
        ownerType: LEDGER_OWNER_TYPES.ASSIGNEE,
        ticketId: { in: waiting.map((t) => t.id) },
        endedAt: { not: null },
      },
      _max: { endedAt: true },
    });
    const lastBy = new Map(lastEnded.map((r) => [r.ticketId, r._max.endedAt?.getTime() ?? 0]));
    const ordered = [...waiting].sort((a, b) => {
      const la = lastBy.get(a.id);
      const lb = lastBy.get(b.id);
      if (la !== undefined || lb !== undefined) return (lb ?? -1) - (la ?? -1);
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    for (const t of ordered) {
      const result = await this.startAssigneeTimer({
        ticketId: t.id,
        workerId,
        mode: 'RESUME',
        source: LEDGER_SOURCES.SYSTEM,
      }, tx);
      if (result.outcome === 'STARTED' || result.outcome === 'ALREADY_ACTIVE') return result;
      if (result.outcome !== 'INELIGIBLE') return result; // worker unavailable / busy: stop
    }
    return { outcome: 'NOTHING_TO_DO' as const };
  }

  private async workerAvailability(tx: Prisma.TransactionClient, userId: string): Promise<
    | { state: 'WORKING'; workSessionId: string }
    | { state: 'ON_BREAK'; breakLogId: string }
    | { state: 'OFF' }
  > {
    const session = await tx.workSession.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { breakLogs: { where: { endAt: null }, orderBy: { startAt: 'desc' }, take: 1 } },
    });
    const closed = !session || !!session.logoutAt || ['LOGGED_OUT', 'AUTO_CLOSED'].includes(session.status);
    if (closed) return { state: 'OFF' };
    if (WORKING_SESSION_STATUSES.includes(session.status)) {
      return { state: 'WORKING', workSessionId: session.id };
    }
    if (session.status === 'ON_BREAK' && session.breakLogs?.[0]) {
      return { state: 'ON_BREAK', breakLogId: session.breakLogs[0].id };
    }
    return { state: 'OFF' };
  }

  // REWORK while a REWORK decision's segment is open (reject() stamps
  // reworkStartedAt before the ticket re-enters IN_PROGRESS), WORK otherwise.
  private async resolveStage(tx: Prisma.TransactionClient, ticketId: string) {
    const openRework = await tx.reviewCycleLog.findFirst({
      where: { ticketId, decision: 'REWORK', reworkStartedAt: { not: null }, reworkEndedAt: null },
      orderBy: { cycleNo: 'desc' },
    });
    return openRework ? LEDGER_STAGES.REWORK : LEDGER_STAGES.WORK;
  }

  /**
   * The single way an employee ticket timer starts. The owner is always the
   * ticket's primary assignee (`workerId`), never whoever clicked; the caller
   * passes the actor only to audit records, not here.
   *
   * Everything happens under the worker's timer lock, re-reading the ticket and
   * the worker's session inside it, so the checks cannot go stale:
   *   - ticket must be IN_PROGRESS, not blocked, and still assigned to workerId
   *   - an existing active log on this ticket is returned (idempotent)
   *   - at most one active log per worker (see AssigneeTimerMode)
   *   - a worker who is not working never gets a running clock
   */
  async startAssigneeTimer(input: {
    ticketId: string;
    workerId: string;
    mode: AssigneeTimerMode;
    source: string;
    stage?: string;
  }, tx?: Prisma.TransactionClient): Promise<{ outcome: AssigneeTimerOutcome; log?: any; pausedLogIds?: string[] }> {
    // Inside a caller's transaction a unique-index failure has already aborted
    // that transaction, so nothing can be retried here: report the conflict and
    // let the caller's whole business change roll back (HTTP 409).
    if (tx) {
      try {
        return await this.startAssigneeTimerOnce(input, tx);
      } catch (err) {
        if (isOneActiveTimerViolation(err)) throw new ConflictException(ONE_ACTIVE_TIMER_CONFLICT);
        throw err;
      }
    }
    // Standalone: the worker lock serialises every ledger writer, so the
    // one-active-timer unique index (Phase 2D1) should never fire here. If a
    // writer outside the lock slipped a row in, the whole attempt rolled back;
    // re-run it once so it sees that row and takes the normal switch /
    // idempotent / wait path.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.startAssigneeTimerOnce(input);
      } catch (err) {
        if (!isOneActiveTimerViolation(err)) throw err;
        if (attempt >= 2) throw new ConflictException(ONE_ACTIVE_TIMER_CONFLICT);
      }
    }
  }

  private async startAssigneeTimerOnce(input: {
    ticketId: string;
    workerId: string;
    mode: AssigneeTimerMode;
    source: string;
    stage?: string;
  }, outerTx?: Prisma.TransactionClient): Promise<{ outcome: AssigneeTimerOutcome; log?: any; pausedLogIds?: string[] }> {
    const { ticketId, workerId, mode } = input;
    return this.inTransaction(outerTx, async (tx) => {
      await this.lockWorkerTimers(tx, workerId);

      const ticket = await tx.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, status: true, isBlocked: true, assignedToId: true },
      });
      if (!ticket || ticket.status !== 'IN_PROGRESS' || ticket.isBlocked || ticket.assignedToId !== workerId) {
        return { outcome: 'INELIGIBLE' as const };
      }

      const active = await tx.ticketTimeLog.findMany({
        where: { userId: workerId, endedAt: null },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      });
      const same = active.find((l) => l.ticketId === ticketId && l.ownerType === LEDGER_OWNER_TYPES.ASSIGNEE);
      const others = active.filter((l) => l !== same);

      if (same) {
        // Already timing this ticket. An explicit start still enforces
        // one-active against any overlap left behind by older code.
        const pausedLogIds: string[] = [];
        if (mode === 'START') {
          const now = this.tva.now();
          for (const o of others) {
            await this.closeLog(tx, o, now, LEDGER_PAUSE_REASONS.SWITCHED);
            pausedLogIds.push(o.id);
          }
        }
        return { outcome: 'ALREADY_ACTIVE' as const, log: same, pausedLogIds };
      }
      if (others.length > 0 && mode !== 'START') {
        return { outcome: 'OTHER_ACTIVE' as const };
      }

      const now = this.tva.now();
      const pausedLogIds: string[] = [];
      for (const o of others) {
        await this.closeLog(tx, o, now, LEDGER_PAUSE_REASONS.SWITCHED);
        pausedLogIds.push(o.id);
      }

      const stage = input.stage ?? (await this.resolveStage(tx, ticketId));
      const base = {
        ticketId,
        userId: workerId,
        stage,
        ownerType: LEDGER_OWNER_TYPES.ASSIGNEE,
        source: input.source,
        countsAsWork: true,
        startedAt: now,
      };

      const availability = await this.workerAvailability(tx, workerId);
      if (availability.state === 'WORKING') {
        const log = await tx.ticketTimeLog.create({
          data: { ...base, workSessionId: availability.workSessionId },
        });
        return { outcome: 'STARTED' as const, log, pausedLogIds };
      }

      if (mode === 'RESUME') return { outcome: 'WORKER_UNAVAILABLE' as const, pausedLogIds };

      if (mode === 'UNBLOCK') {
        // Only carry the ticket forward if it is what the worker was last on;
        // otherwise unblocking must not displace the worker's actual next ticket.
        const latest = await tx.ticketTimeLog.findFirst({
          where: { userId: workerId, ownerType: LEDGER_OWNER_TYPES.ASSIGNEE, endedAt: { not: null } },
          orderBy: [{ endedAt: 'desc' }, { startedAt: 'desc' }, { id: 'desc' }],
        });
        if (!latest || latest.ticketId !== ticketId) {
          return { outcome: 'WORKER_UNAVAILABLE' as const, pausedLogIds };
        }
      }

      if (mode === 'HANDOVER') {
        // The new assignee's own paused ticket keeps priority: their break end
        // or next workday start resumes that one, never the handed-over one.
        const latest = await tx.ticketTimeLog.findFirst({
          where: { userId: workerId, ownerType: LEDGER_OWNER_TYPES.ASSIGNEE, endedAt: { not: null } },
          orderBy: [{ endedAt: 'desc' }, { startedAt: 'desc' }, { id: 'desc' }],
        });
        if (latest && latest.ticketId !== ticketId && WORKDAY_RESUMABLE_PAUSE_REASONS.includes(latest.pauseReason ?? '')) {
          return { outcome: 'WORKER_UNAVAILABLE' as const, pausedLogIds };
        }
      }

      // Zero-length marker: records who owns the clock and lets the matching
      // break end (same breakLogId) or the next workday start resume it.
      const log = await tx.ticketTimeLog.create({
        data: {
          ...base,
          endedAt: now,
          durationSeconds: 0,
          pauseReason: availability.state === 'ON_BREAK'
            ? LEDGER_PAUSE_REASONS.BREAK
            : LEDGER_PAUSE_REASONS.AWAITING_WORKDAY,
          breakLogId: availability.state === 'ON_BREAK' ? availability.breakLogId : undefined,
        },
      });
      return { outcome: 'DEFERRED' as const, log, pausedLogIds };
    });
  }

  /**
   * Break end: resumes exactly one ticket, the most recent one that this break
   * paused, and only if it is still workable by this worker. Never resumes a
   * ticket paused by anything else, never creates a second active log.
   */
  async resumeLogsForBreak(breakLogId: string, userId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const candidate = await db.ticketTimeLog.findFirst({
      where: { userId, breakLogId, pauseReason: LEDGER_PAUSE_REASONS.BREAK, ownerType: LEDGER_OWNER_TYPES.ASSIGNEE },
      orderBy: [{ endedAt: 'desc' }, { startedAt: 'desc' }, { id: 'desc' }],
    });
    if (candidate) {
      const result = await this.startAssigneeTimer({
        ticketId: candidate.ticketId,
        workerId: userId,
        mode: 'RESUME',
        source: LEDGER_SOURCES.WORKDAY,
        stage: candidate.stage,
      }, tx);
      if (result.outcome === 'STARTED' || result.outcome === 'ALREADY_ACTIVE') return [result.log];
    }
    // The ticket this break paused has left IN_PROGRESS (or there was none):
    // pick up the next waiting one rather than leave the worker with no clock.
    const next = await this.resumeNextWaitingTicket(userId, undefined, tx);
    return 'log' in next && next.log ? [next.log] : [];
  }

  /**
   * Workday start (Start Work, Punch In, resume after auto-close): resumes the
   * worker's most recent ticket segment when the worker's day, not the ticket,
   * stopped it. Selection is deterministic from the ledger alone: the latest
   * ended ASSIGNEE segment by (endedAt, startedAt, id). If that segment was
   * stopped deliberately (review, switch, block, unassign) nothing resumes;
   * there is no fallback to an older ticket. The new segment starts now, so
   * the time between days is never counted.
   */
  async resumeAfterWorkdayStart(userId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const latest = await db.ticketTimeLog.findFirst({
      where: { userId, ownerType: LEDGER_OWNER_TYPES.ASSIGNEE, endedAt: { not: null } },
      orderBy: [{ endedAt: 'desc' }, { startedAt: 'desc' }, { id: 'desc' }],
    });
    if (latest && WORKDAY_RESUMABLE_PAUSE_REASONS.includes(latest.pauseReason ?? '')) {
      const result = await this.startAssigneeTimer({
        ticketId: latest.ticketId,
        workerId: userId,
        mode: 'RESUME',
        source: LEDGER_SOURCES.WORKDAY,
        stage: latest.stage,
      }, tx);
      if (result.outcome === 'STARTED' || result.outcome === 'ALREADY_ACTIVE') return result;
    }
    // The last segment was a deliberate stop (review, done, block...) or its
    // ticket is no longer workable: start the next waiting ticket instead, so
    // yesterday's IN_PROGRESS work is never stranded.
    const next = await this.resumeNextWaitingTicket(userId, undefined, tx);
    return next.outcome === 'NOTHING_TO_DO' ? { outcome: 'NO_CANDIDATE' as const } : next;
  }

  /**
   * Closes the open rework segment (rework → REVIEW) and freezes its actual
   * productive seconds from the ledger. Call after the worker's log has been
   * closed. Idempotent: returns null when no rework segment is open.
   */
  async closeReworkSegment(ticketId: string, endedAt?: Date, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const cycle = await db.reviewCycleLog.findFirst({
      where: { ticketId, decision: 'REWORK', reworkStartedAt: { not: null }, reworkEndedAt: null },
      orderBy: { cycleNo: 'desc' },
    });
    if (!cycle) return null;

    const at = endedAt ?? this.tva.now();
    const agg = await db.ticketTimeLog.aggregate({
      where: {
        ticketId,
        ownerType: LEDGER_OWNER_TYPES.ASSIGNEE,
        countsAsWork: true,
        endedAt: { not: null },
        startedAt: { gte: cycle.reworkStartedAt!, lte: at },
      },
      _sum: { durationSeconds: true },
    });

    return db.reviewCycleLog.update({
      where: { id: cycle.id },
      data: { reworkEndedAt: at, reworkWorkSeconds: agg._sum.durationSeconds ?? 0 },
    });
  }

  async resumeWorkLog(input: {
    ticketId: string;
    userId: string;
    stage: string;
    ownerType: string;
    source: string;
    workSessionId?: string;
    countsAsWork?: boolean;
  }) {
    return this.startWorkLog(input);
  }

  async startReviewCycle(input: {
    ticketId: string;
    assigneeId?: string;
    reviewerId?: string;
    reviewStartedAt?: Date;
  }, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const existing = await db.reviewCycleLog.findFirst({
      where: { ticketId: input.ticketId },
      orderBy: { cycleNo: 'desc' },
    });

    const cycleNo = existing ? existing.cycleNo + 1 : 1;

    return db.reviewCycleLog.create({
      data: {
        ticketId: input.ticketId,
        cycleNo,
        assigneeId: input.assigneeId,
        reviewerId: input.reviewerId,
        reviewStartedAt: input.reviewStartedAt,
      },
    });
  }

  async endReviewCycle(input: {
    ticketId: string;
    cycleNo?: number;
    decision: string;
    reviewerId?: string;
    feedback?: string;
    reviewEndedAt?: Date;
    reworkStartedAt?: Date;
    reworkEstimatedMinutes?: number | null;
    assigneeWorkSeconds?: number;
    reviewerWorkSeconds?: number;
    taskEfficiencyRating?: number | null;
    employeePerformanceRating?: number | null;
    employeeAttitudeRating?: number | null;
    ratingComment?: string | null;
  }, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    let cycle;
    if (input.cycleNo) {
      cycle = await db.reviewCycleLog.findUnique({
        where: { ticketId_cycleNo: { ticketId: input.ticketId, cycleNo: input.cycleNo } },
      });
    } else {
      cycle = await db.reviewCycleLog.findFirst({
        where: { ticketId: input.ticketId, decision: null },
        orderBy: { cycleNo: 'desc' },
      });
    }

    if (!cycle) return null;

    const reviewEndedAt = input.reviewEndedAt ?? this.tva.now();
    let assigneeStartBound = new Date(0);

    if (cycle.cycleNo > 1) {
      const prevCycle = await db.reviewCycleLog.findUnique({
        where: { ticketId_cycleNo: { ticketId: input.ticketId, cycleNo: cycle.cycleNo - 1 } },
      });
      if (prevCycle?.reworkStartedAt) {
        assigneeStartBound = prevCycle.reworkStartedAt;
      }
    }

    const assigneeLogs = await db.ticketTimeLog.aggregate({
      where: {
        ticketId: input.ticketId,
        ownerType: 'ASSIGNEE',
        countsAsWork: true,
        startedAt: { gte: assigneeStartBound, lte: cycle.reviewStartedAt || this.tva.now() },
      },
      _sum: { durationSeconds: true },
    });

    const reviewerLogs = await db.ticketTimeLog.aggregate({
      where: {
        ticketId: input.ticketId,
        ownerType: 'REVIEWER',
        startedAt: { gte: cycle.reviewStartedAt || new Date(0), lte: reviewEndedAt },
      },
      _sum: { durationSeconds: true },
    });

    const assigneeWorkSeconds = input.assigneeWorkSeconds ?? assigneeLogs._sum.durationSeconds ?? 0;
    const reviewerWorkSeconds = input.reviewerWorkSeconds ?? reviewerLogs._sum.durationSeconds ?? 0;

    return db.reviewCycleLog.update({
      where: { id: cycle.id },
      data: {
        decision: input.decision,
        reviewerId: input.reviewerId,
        feedback: input.feedback,
        reviewEndedAt,
        reworkStartedAt: input.reworkStartedAt,
        reworkEstimatedMinutes: input.reworkEstimatedMinutes ?? undefined,
        assigneeWorkSeconds,
        reviewerWorkSeconds,
        taskEfficiencyRating: input.taskEfficiencyRating,
        employeePerformanceRating: input.employeePerformanceRating,
        employeeAttitudeRating: input.employeeAttitudeRating,
        ratingComment: input.ratingComment,
      },
    });
  }

  async assertNoOpenLogsForClosedTicket(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (ticket?.status === 'CLOSED') {
      const activeLogs = await this.prisma.ticketTimeLog.findMany({
        where: { ticketId, endedAt: null },
      });
      if (activeLogs.length > 0) {
        throw new BadRequestException('Closed ticket cannot have active time logs');
      }
    }
  }
}
