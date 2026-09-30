/**
 * Phase 2D1 ticket timer cleanup: closes invalid or duplicate ACTIVE employee
 * (ASSIGNEE) timer rows so the one-active-timer unique index can be created.
 *
 * One planner decides what is wrong. The dry run (default) runs it inside a
 * READ ONLY transaction and reports; --apply runs the very same planner inside
 * a read-write transaction, after taking every affected worker's timer lock
 * and row locks, closes exactly the rows it planned, re-plans, and rolls the
 * whole transaction back unless the result is CLEAN.
 *
 * What it changes, and nothing else: on an active ASSIGNEE row it sets
 * endedAt and updatedAt to the effective end (the repair time, or startedAt
 * for a future-dated row), durationSeconds, countsAsWork = false and
 * pauseReason = INTEGRITY_REPAIR. It never deletes a row, never touches ended
 * rows, reviewer/manager rows, tickets, assignments, work sessions, users or
 * SLA fields. countsAsWork = false keeps repaired time out of every
 * productive-time total (see isProductiveLog in the ticket ledger).
 *
 * The database gate is the Phase 2C one: dedicated loopback integration
 * database only, server identity verified, no production override.
 */
import { AuditConfigError, QueryClient, ServerIdentity, assertTargetServer } from './ticket-time-integrity';

export const REPAIR_PAUSE_REASON = 'INTEGRITY_REPAIR';

/** Why an active employee timer row must be closed. Fixed order for reports. */
export const CLEANUP_REASONS = [
  'TICKET_NOT_IN_PROGRESS',
  'TICKET_BLOCKED',
  'TICKET_UNASSIGNED',
  'NOT_PRIMARY_ASSIGNEE',
  'USER_NOT_WORKING',
  'NO_OPEN_WORKING_SESSION',
  'SESSION_MISSING',
  'SESSION_OTHER_USER',
  'SESSION_CLOSED',
  'SESSION_SUPERSEDED',
  'REWORK_WITHOUT_OPEN_CYCLE',
  'DUPLICATE_NOT_SURVIVOR',
] as const;

/**
 * Deliberately NOT a cleanup reason: a timer that has simply run for a long
 * time. Age alone does not prove corruption, so the Phase 2C audit's
 * ACTIVE_LOG_OLDER_THAN_THRESHOLD stays report-only.
 */
export type CleanupReason = (typeof CLEANUP_REASONS)[number];

export interface ActiveRow {
  id: string;
  userId: string;
  ticketKey: string;
  startedAt: Date;
  stage: string;
  hasOpenReworkCycle: boolean;
  ticketStatus: string;
  isBlocked: boolean;
  assignedTo: string | null;
  userStatus: string | null;
  sessionMissing: boolean;
  sessionOtherUser: boolean;
  sessionClosed: boolean;
  sessionSuperseded: boolean;
  hasOpenWorkingSession: boolean;
}

export interface PlannedClosure {
  logId: string;
  userId: string;
  ticketKey: string;
  reasons: CleanupReason[];
}

export interface Survivor {
  userId: string;
  keptLogId: string;
  keptTicketKey: string;
  closedLogIds: string[];
}

export interface CleanupPlan {
  inspectedActiveRows: number;
  closures: PlannedClosure[];
  survivors: Survivor[];
}

/** Invalid-state reasons for one active row, independent of other rows. */
export function stateReasons(r: ActiveRow): CleanupReason[] {
  const out: CleanupReason[] = [];
  if (r.ticketStatus !== 'IN_PROGRESS') out.push('TICKET_NOT_IN_PROGRESS');
  if (r.isBlocked) out.push('TICKET_BLOCKED');
  if (r.assignedTo === null) out.push('TICKET_UNASSIGNED');
  else if (r.assignedTo !== r.userId) out.push('NOT_PRIMARY_ASSIGNEE');
  if (r.userStatus !== 'WORKING') out.push('USER_NOT_WORKING');
  if (!r.hasOpenWorkingSession) out.push('NO_OPEN_WORKING_SESSION');
  if (r.sessionMissing) out.push('SESSION_MISSING');
  else if (r.sessionOtherUser) out.push('SESSION_OTHER_USER');
  else {
    if (r.sessionClosed) out.push('SESSION_CLOSED');
    if (r.sessionSuperseded) out.push('SESSION_SUPERSEDED');
  }
  if (r.stage === 'REWORK' && !r.hasOpenReworkCycle) out.push('REWORK_WITHOUT_OPEN_CYCLE');
  return out;
}

/**
 * Deterministic survivor among a user's otherwise-valid active rows: the most
 * recently started; equal start times resolve to the greatest id.
 */
export function pickSurvivor<T extends { id: string; startedAt: Date }>(rows: T[]): T {
  return [...rows].sort((a, b) => {
    const t = b.startedAt.getTime() - a.startedAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  })[0];
}

/** Pure planner. Input order does not matter; output order is fixed. */
export function planCleanup(rows: ActiveRow[]): CleanupPlan {
  const closures: PlannedClosure[] = [];
  const survivors: Survivor[] = [];
  const validByUser = new Map<string, ActiveRow[]>();

  for (const r of rows) {
    const reasons = stateReasons(r);
    if (reasons.length) closures.push({ logId: r.id, userId: r.userId, ticketKey: r.ticketKey, reasons });
    else validByUser.set(r.userId, [...(validByUser.get(r.userId) ?? []), r]);
  }

  for (const [userId, valid] of validByUser) {
    if (valid.length < 2) continue;
    const kept = pickSurvivor(valid);
    const losers = valid.filter((r) => r.id !== kept.id);
    for (const r of losers) {
      closures.push({ logId: r.id, userId, ticketKey: r.ticketKey, reasons: ['DUPLICATE_NOT_SURVIVOR'] });
    }
    survivors.push({
      userId,
      keptLogId: kept.id,
      keptTicketKey: kept.ticketKey,
      closedLogIds: losers.map((r) => r.id).sort(),
    });
  }

  const byId = (a: { logId: string }, b: { logId: string }) => (a.logId < b.logId ? -1 : a.logId > b.logId ? 1 : 0);
  closures.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : byId(a, b)));
  survivors.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  return { inspectedActiveRows: rows.length, closures, survivors };
}

// ── Database access ──────────────────────────────────────────────────────────

const ACTIVE_ROWS_SQL = `
  SELECT l.id, l."userId" AS user_id, t."ticketId" AS ticket_key, l."startedAt" AS started_at, l.stage,
         EXISTS (
            SELECT 1 FROM review_cycle_logs c
            WHERE c."ticketId" = l."ticketId" AND c.decision = 'REWORK'
              AND c."reworkStartedAt" IS NOT NULL AND c."reworkEndedAt" IS NULL) AS has_open_rework_cycle,
         t.status::text AS ticket_status, t."isBlocked" AS is_blocked, t."assignedToId" AS assigned_to,
         u."currentStatus" AS user_status,
         (s.id IS NULL) AS session_missing,
         (s.id IS NOT NULL AND s."userId" IS DISTINCT FROM l."userId") AS session_other_user,
         (s.id IS NOT NULL AND (s."logoutAt" IS NOT NULL OR s.status IN ('LOGGED_OUT', 'AUTO_CLOSED'))) AS session_closed,
         (s.id IS NOT NULL AND EXISTS (
            SELECT 1 FROM work_sessions n WHERE n."userId" = l."userId" AND n.date > s.date)) AS session_superseded,
         EXISTS (
            SELECT 1 FROM work_sessions w
            WHERE w."userId" = l."userId" AND w."logoutAt" IS NULL AND w.status = 'WORKING') AS has_open_working_session
  FROM ticket_time_logs l
  JOIN tickets t ON t.id = l."ticketId"
  JOIN users u ON u.id = l."userId"
  LEFT JOIN work_sessions s ON s.id = l."workSessionId"
  WHERE l."ownerType" = 'ASSIGNEE' AND l."endedAt" IS NULL
  ORDER BY l."userId", l.id`;

export async function loadActiveRows(client: QueryClient): Promise<ActiveRow[]> {
  const rows = await client.$queryRawUnsafe<any[]>(ACTIVE_ROWS_SQL);
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    ticketKey: String(r.ticket_key),
    startedAt: new Date(r.started_at),
    stage: String(r.stage),
    hasOpenReworkCycle: Boolean(r.has_open_rework_cycle),
    ticketStatus: String(r.ticket_status),
    isBlocked: Boolean(r.is_blocked),
    assignedTo: r.assigned_to ?? null,
    userStatus: r.user_status ?? null,
    sessionMissing: Boolean(r.session_missing),
    sessionOtherUser: Boolean(r.session_other_user),
    sessionClosed: Boolean(r.session_closed),
    sessionSuperseded: Boolean(r.session_superseded),
    hasOpenWorkingSession: Boolean(r.has_open_working_session),
  }));
}

type TxClient = QueryClient & { $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> };

interface TransactionalClient {
  $transaction<R>(fn: (tx: TxClient) => Promise<R>, options?: { maxWait?: number; timeout?: number }): Promise<R>;
}

export interface CleanupOptions {
  /** The single repair timestamp used for every row closed by one apply run. */
  repairAt: Date;
  sampleLimit: number;
}

export interface CleanupReport {
  mode: 'dry-run' | 'apply';
  result: 'CLEAN' | 'CHANGES_REQUIRED' | 'APPLIED';
  repairAt: string;
  database: { name: string; address: string | null; port: string; serverVersion: string };
  inspectedActiveRows: number;
  affectedUsers: number;
  /** Rows the dry run would close, or the apply run did close. */
  rowsToClose: number;
  reasonCounts: Record<CleanupReason, number>;
  survivors: Survivor[];
  samples: PlannedClosure[];
}

function report(mode: CleanupReport['mode'], who: ServerIdentity, plan: CleanupPlan, opts: CleanupOptions): CleanupReport {
  const reasonCounts = Object.fromEntries(CLEANUP_REASONS.map((r) => [r, 0])) as Record<CleanupReason, number>;
  for (const c of plan.closures) for (const r of c.reasons) reasonCounts[r] += 1;
  const limit = Math.max(0, Math.floor(opts.sampleLimit));
  const changes = plan.closures.length > 0;
  return {
    mode,
    result: !changes ? 'CLEAN' : mode === 'apply' ? 'APPLIED' : 'CHANGES_REQUIRED',
    repairAt: opts.repairAt.toISOString(),
    database: { name: who.db, address: who.addr ?? null, port: String(who.port), serverVersion: String(who.version).split(' ')[0] },
    inspectedActiveRows: plan.inspectedActiveRows,
    affectedUsers: new Set(plan.closures.map((c) => c.userId)).size,
    rowsToClose: plan.closures.length,
    reasonCounts,
    survivors: plan.survivors.slice(0, limit),
    samples: plan.closures.slice(0, limit),
  };
}

/** Dry run: the planner inside a READ ONLY transaction. Writes nothing. */
export async function runCleanupDryRun(prisma: TransactionalClient, opts: CleanupOptions): Promise<CleanupReport> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '60s'`);
      const who = await assertTargetServer(tx);
      if (who.read_only !== 'on') throw new AuditConfigError('Dry-run transaction is not read-only; refusing.');
      return report('dry-run', who, planCleanup(await loadActiveRows(tx)), opts);
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

export interface ApplyHooks {
  /** Test-only fault injection, called after each row is closed. */
  afterRowClosed?: (index: number, logId: string) => Promise<void> | void;
}

/**
 * Apply: one read-write transaction. Locks, re-plans, closes exactly the
 * planned rows at `repairAt`, re-plans again and requires CLEAN. Any failure
 * rolls every change back.
 */
export async function runCleanupApply(
  prisma: TransactionalClient,
  opts: CleanupOptions,
  hooks: ApplyHooks = {},
): Promise<CleanupReport> {
  const repairIso = opts.repairAt.toISOString();
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '120s'`);
      const who = await assertTargetServer(tx);

      // Same advisory lock the ledger takes for every timer start/pause, in a
      // fixed order so two cleanups cannot deadlock; then the rows themselves.
      const users = await tx.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT "userId" AS user_id FROM ticket_time_logs
         WHERE "ownerType" = 'ASSIGNEE' AND "endedAt" IS NULL ORDER BY 1`,
      );
      for (const u of users) {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `ticket-timer:${u.user_id}`);
      }
      await tx.$queryRawUnsafe(
        `SELECT id FROM ticket_time_logs WHERE "ownerType" = 'ASSIGNEE' AND "endedAt" IS NULL ORDER BY id FOR UPDATE`,
      );

      const plan = planCleanup(await loadActiveRows(tx));
      let i = 0;
      for (const c of plan.closures) {
        const changed = await tx.$executeRawUnsafe(
          `UPDATE ticket_time_logs
             SET "endedAt" = GREATEST($2::timestamp, "startedAt"),
                 "durationSeconds" = GREATEST(0, floor(extract(epoch FROM (GREATEST($2::timestamp, "startedAt") - "startedAt"))))::int,
                 "countsAsWork" = false,
                 "pauseReason" = $3,
                 "updatedAt" = GREATEST($2::timestamp, "startedAt")
           WHERE id = $1 AND "ownerType" = 'ASSIGNEE' AND "endedAt" IS NULL`,
          c.logId,
          repairIso,
          REPAIR_PAUSE_REASON,
        );
        if (changed !== 1) throw new Error(`Row ${c.logId} changed during cleanup; rolled back.`);
        await hooks.afterRowClosed?.(i, c.logId);
        i += 1;
      }

      const after = planCleanup(await loadActiveRows(tx));
      if (after.closures.length > 0) {
        throw new Error(`Cleanup left ${after.closures.length} invalid active row(s); rolled back.`);
      }
      return report('apply', who, plan, opts);
    },
    { maxWait: 10_000, timeout: 180_000 },
  );
}

// ── Exit codes, arguments and output ─────────────────────────────────────────

export const CLEANUP_EXIT_OK = 0;
export const CLEANUP_EXIT_FAILURE = 1;
export const CLEANUP_EXIT_CHANGES_REQUIRED = 2;

export function cleanupExitCode(r: CleanupReport): number {
  return r.result === 'CHANGES_REQUIRED' ? CLEANUP_EXIT_CHANGES_REQUIRED : CLEANUP_EXIT_OK;
}

export interface CleanupArgs {
  apply: boolean;
  json: boolean;
  options: CleanupOptions;
}

export function parseCleanupArgs(argv: string[], dbName: string, clock: () => Date = () => new Date()): CleanupArgs {
  let apply = false;
  let json = false;
  let confirm: string | undefined;
  let sampleLimit = 20;
  let repairAt = clock();
  for (const arg of argv) {
    const [key, value] = arg.split('=', 2);
    if (key === '--apply' && value === undefined) apply = true;
    else if (key === '--json' && value === undefined) json = true;
    else if (key === '--confirm-database') confirm = value;
    else if (key === '--sample') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new AuditConfigError('--sample must be a non-negative number.');
      sampleLimit = Math.min(200, Math.floor(n));
    } else if (key === '--now') {
      repairAt = new Date(value ?? '');
      if (Number.isNaN(repairAt.getTime())) throw new AuditConfigError('--now must be an ISO timestamp.');
    } else if (['--fix', '--repair', '--force', '--yes'].includes(key)) {
      throw new AuditConfigError(`${key} is not supported. The only write mode is --apply --confirm-database=<name>.`);
    } else {
      throw new AuditConfigError(`Unknown argument "${key}".`);
    }
  }
  if (apply && confirm !== dbName) {
    throw new AuditConfigError(`--apply requires --confirm-database=${dbName}, naming the database it will change.`);
  }
  if (!apply && confirm !== undefined) {
    throw new AuditConfigError('--confirm-database is only meaningful with --apply.');
  }
  return { apply, json, options: { repairAt, sampleLimit } };
}

export function formatCleanup(r: CleanupReport): string {
  const verb = r.mode === 'apply' ? 'closed' : 'would close';
  const lines = [
    `Ticket timer cleanup (${r.mode}): ${r.result}`,
    `  database   ${r.database.name} @ ${r.database.address ?? 'local socket'}:${r.database.port} (PostgreSQL ${r.database.serverVersion})`,
    `  repair at  ${r.repairAt}`,
    `  inspected  ${r.inspectedActiveRows} active employee timer rows`,
    `  ${verb} ${r.rowsToClose} rows for ${r.affectedUsers} users`,
    '',
    '  reasons:',
    ...CLEANUP_REASONS.filter((k) => r.reasonCounts[k] > 0).map((k) => `    ${k}: ${r.reasonCounts[k]}`),
  ];
  if (r.survivors.length) {
    lines.push('', '  duplicate groups (kept timer):');
    for (const s of r.survivors) {
      lines.push(`    user ${s.userId}: kept ${s.keptLogId} [${s.keptTicketKey}], closing ${s.closedLogIds.join(', ')}`);
    }
  }
  if (r.samples.length) {
    lines.push('', `  rows (first ${r.samples.length} of ${r.rowsToClose}):`);
    for (const c of r.samples) lines.push(`    ${c.logId} [${c.ticketKey}] user ${c.userId}: ${c.reasons.join(', ')}`);
  }
  return lines.join('\n');
}
