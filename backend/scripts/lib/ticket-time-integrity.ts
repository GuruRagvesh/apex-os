/**
 * Ticket timer integrity audit: the checks, the database gate and the report.
 *
 * READ-ONLY BY CONSTRUCTION. Every query runs inside one transaction that is
 * declared READ ONLY before the first SELECT, so PostgreSQL itself rejects any
 * write, and the module contains no INSERT/UPDATE/DELETE/DDL at all. There is
 * no repair or apply mode here; reconciliation is a separate, later tool.
 *
 * The CLI lives in scripts/ticket-time-integrity-audit.ts. This module has no
 * side effects on import and never reads backend/.env.
 */

// ── Database gate ────────────────────────────────────────────────────────────
//
// Mirrors test/integration-pg/db-guard.ts: a DENY list, then an ALLOW list
// (loopback host + the dedicated database name), then the server is asked who
// it is. There is deliberately no production override yet.

export const AUDIT_DB_NAME = 'apex_os_attendance_integration';

const DENY = [
  /render\.com/i,
  /amazonaws\.com/i,
  /\bprod\b/i,
  /production/i,
  /staging/i,
  /neon\.tech/i,
  /supabase/i,
];

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export class AuditConfigError extends Error {}

export interface AuditTarget {
  host: string;
  port: string;
  database: string;
}

/** Validates DATABASE_URL, or throws. Never echoes the URL or its password. */
export function assertAuditTarget(url: string | undefined): AuditTarget {
  if (!url || !url.trim()) {
    throw new AuditConfigError(
      `DATABASE_URL is not set. The audit must be pointed explicitly at ${AUDIT_DB_NAME}; it never guesses.`,
    );
  }
  for (const pattern of DENY) {
    if (pattern.test(url)) {
      throw new AuditConfigError(
        `DATABASE_URL matches a forbidden pattern (${pattern}). Hosted, staging and production databases are refused.`,
      );
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AuditConfigError('DATABASE_URL is not a parseable URL.');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new AuditConfigError('DATABASE_URL is not a postgresql:// URL.');
  }
  const host = parsed.hostname;
  if (!LOOPBACK.has(host)) {
    throw new AuditConfigError(`DATABASE_URL host "${host}" is not loopback. Only a local database is audited.`);
  }
  const database = parsed.pathname.replace(/^\//, '');
  if (database !== AUDIT_DB_NAME) {
    throw new AuditConfigError(`DATABASE_URL names database "${database}", not "${AUDIT_DB_NAME}".`);
  }
  return { host, port: parsed.port || '5432', database };
}

/** Removes the URL and its password from any text that might be printed. */
export function redactSecrets(text: string, url: string | undefined): string {
  let out = String(text ?? '');
  if (url) {
    out = out.split(url).join('<DATABASE_URL>');
    try {
      const password = decodeURIComponent(new URL(url).password);
      if (password) out = out.split(password).join('<redacted>');
    } catch {
      /* unparseable URL: nothing more to strip */
    }
  }
  return out.replace(/(postgres(?:ql)?:\/\/[^:/@\s]*:)[^@\s]*@/gi, '$1<redacted>@');
}

// ── Checks ───────────────────────────────────────────────────────────────────

export interface Sample {
  /** Log, user, cycle or ticket id the finding is about. */
  ref: string;
  /** Human ticket key (e.g. TKT-001), when the finding is about one ticket. */
  ticketKey: string | null;
  detail: string;
}

export interface CheckResult {
  code: string;
  description: string;
  unit: 'logs' | 'users' | 'tickets' | 'cycles' | 'pairs';
  count: number;
  samples: Sample[];
}

export interface AuditReport {
  result: 'CLEAN' | 'VIOLATIONS_FOUND';
  auditedAt: string;
  database: { name: string; address: string | null; port: string; serverVersion: string };
  options: { staleHours: number; sampleLimit: number };
  totals: {
    timeLogs: number;
    activeAssigneeLogs: number;
    ticketsWithActiveLog: number;
    usersWithActiveLog: number;
  };
  violationTotal: number;
  checks: CheckResult[];
}

export interface AuditOptions {
  now: Date;
  staleHours: number;
  sampleLimit: number;
}

/** Active ASSIGNEE logs joined to their ticket and user. $1 = now, $2 = stale-before. */
const ACTIVE = `
  active AS (
    SELECT l.id, l."ticketId", l."userId", l.stage, l."startedAt", l."workSessionId",
           t."ticketId" AS ticket_key, t.status::text AS ticket_status, t."isBlocked" AS is_blocked,
           t."assignedToId" AS assigned_to, u."currentStatus" AS user_status
    FROM ticket_time_logs l
    JOIN tickets t ON t.id = l."ticketId"
    JOIN users u ON u.id = l."userId"
    WHERE l."ownerType" = 'ASSIGNEE' AND l."endedAt" IS NULL
  )`;

/** Active REVIEWER logs (Phase 4 reviewer active-work clock) joined to ticket and user. */
const ACTIVE_REVIEWER = `
  active_reviewer AS (
    SELECT l.id, l."ticketId", l."userId", l.stage, l."startedAt", l."workSessionId",
           t."ticketId" AS ticket_key, t.status::text AS ticket_status, u."currentStatus" AS user_status
    FROM ticket_time_logs l
    JOIN tickets t ON t.id = l."ticketId"
    JOIN users u ON u.id = l."userId"
    WHERE l."ownerType" = 'REVIEWER' AND l."endedAt" IS NULL
  )`;

const OPEN_REWORK = `
  open_rework AS (
    SELECT c.id, c."ticketId", c."reworkStartedAt"
    FROM review_cycle_logs c
    WHERE c.decision = 'REWORK' AND c."reworkStartedAt" IS NOT NULL AND c."reworkEndedAt" IS NULL
  )`;

interface CheckDef {
  code: string;
  description: string;
  unit: CheckResult['unit'];
  /** Must select (ref text, ticket_key text|null, detail text). */
  sql: string;
}

export const CHECKS: CheckDef[] = [
  {
    code: 'DUPLICATE_ACTIVE_ASSIGNEE_LOGS',
    description: 'A user has more than one active ASSIGNEE log (one timed ticket per user).',
    unit: 'users',
    sql: `WITH ${ACTIVE}
      SELECT "userId" AS ref, NULL::text AS ticket_key,
             count(*)::text || ' active logs on ' || string_agg(ticket_key, ',' ORDER BY ticket_key) AS detail
      FROM active GROUP BY "userId" HAVING count(*) > 1`,
  },
  {
    code: 'ACTIVE_LOG_TICKET_NOT_IN_PROGRESS',
    description: 'An active ASSIGNEE log is on a ticket that is not IN_PROGRESS.',
    unit: 'logs',
    sql: `WITH ${ACTIVE}
      SELECT id AS ref, ticket_key, 'ticket status ' || ticket_status AS detail
      FROM active WHERE ticket_status <> 'IN_PROGRESS'`,
  },
  {
    code: 'ACTIVE_LOG_ON_OPEN_REVIEW_DONE_CLOSED',
    description: 'An active ASSIGNEE log is on an OPEN, REVIEW, DONE or CLOSED ticket.',
    unit: 'logs',
    sql: `WITH ${ACTIVE}
      SELECT id AS ref, ticket_key, 'ticket status ' || ticket_status AS detail
      FROM active WHERE ticket_status IN ('OPEN', 'REVIEW', 'DONE', 'CLOSED')`,
  },
  {
    code: 'ACTIVE_LOG_ON_BLOCKED_TICKET',
    description: 'An active ASSIGNEE log is on a blocked ticket.',
    unit: 'logs',
    sql: `WITH ${ACTIVE}
      SELECT id AS ref, ticket_key, 'ticket is blocked' AS detail FROM active WHERE is_blocked`,
  },
  {
    code: 'ACTIVE_LOG_USER_NOT_WORKING',
    description:
      'An active ASSIGNEE log belongs to a user who is not WORKING (on break, idle, logged out, or with no open WORKING session).',
    unit: 'logs',
    sql: `WITH ${ACTIVE}
      SELECT a.id AS ref, a.ticket_key,
             'user status ' || coalesce(a.user_status, 'NULL') ||
             CASE WHEN ws.id IS NULL THEN ', no open WORKING session' ELSE '' END AS detail
      FROM active a
      LEFT JOIN LATERAL (
        SELECT s.id FROM work_sessions s
        WHERE s."userId" = a."userId" AND s."logoutAt" IS NULL AND s.status = 'WORKING'
        LIMIT 1
      ) ws ON TRUE
      WHERE a.user_status IS DISTINCT FROM 'WORKING' OR ws.id IS NULL`,
  },
  {
    code: 'ACTIVE_LOG_WITH_INVALID_WORK_SESSION',
    description:
      'An active ASSIGNEE log has no linked WorkSession, or is linked to one that belongs to another user, is closed, or has been superseded by a later-dated session of its user.',
    unit: 'logs',
    // LEFT JOIN so a missing link stays visible; the first matching reason wins.
    sql: `WITH ${ACTIVE}
      SELECT a.id AS ref, a.ticket_key,
             CASE
               WHEN s.id IS NULL THEN 'no linked work session'
               WHEN s."userId" IS DISTINCT FROM a."userId" THEN 'linked session belongs to another user'
               WHEN s."logoutAt" IS NOT NULL OR s.status IN ('LOGGED_OUT', 'AUTO_CLOSED')
                 THEN 'session closed (' || s.status || ')'
               ELSE 'session superseded by a later session'
             END AS detail
      FROM active a
      LEFT JOIN work_sessions s ON s.id = a."workSessionId"
      WHERE s.id IS NULL
         OR s."userId" IS DISTINCT FROM a."userId"
         OR s."logoutAt" IS NOT NULL
         OR s.status IN ('LOGGED_OUT', 'AUTO_CLOSED')
         OR EXISTS (SELECT 1 FROM work_sessions n WHERE n."userId" = a."userId" AND n.date > s.date)`,
  },
  {
    code: 'ACTIVE_LOG_NOT_PRIMARY_ASSIGNEE',
    description: "An active ASSIGNEE log belongs to someone other than the ticket's primary assignee.",
    unit: 'logs',
    sql: `WITH ${ACTIVE}
      SELECT id AS ref, ticket_key, 'log owner is not the primary assignee' AS detail
      FROM active WHERE assigned_to IS NOT NULL AND assigned_to <> "userId"`,
  },
  {
    code: 'ACTIVE_LOG_ON_UNASSIGNED_TICKET',
    description: 'An active ASSIGNEE log is on a ticket with no primary assignee.',
    unit: 'logs',
    sql: `WITH ${ACTIVE}
      SELECT id AS ref, ticket_key, 'ticket has no primary assignee' AS detail
      FROM active WHERE assigned_to IS NULL`,
  },
  {
    code: 'ACTIVE_LOG_OLDER_THAN_THRESHOLD',
    description: 'An active ASSIGNEE log has been running longer than the stale threshold.',
    unit: 'logs',
    sql: `WITH ${ACTIVE}
      SELECT id AS ref, ticket_key,
             'running ' || floor(extract(epoch FROM ($1::timestamp - "startedAt")) / 3600)::text || 'h' AS detail
      FROM active WHERE "startedAt" < $2::timestamp`,
  },
  {
    code: 'CLOSED_LOG_MISSING_DURATION',
    description: 'A closed time log has no durationSeconds.',
    unit: 'logs',
    sql: `SELECT l.id AS ref, t."ticketId" AS ticket_key, 'endedAt set, durationSeconds null' AS detail
      FROM ticket_time_logs l JOIN tickets t ON t.id = l."ticketId"
      WHERE l."endedAt" IS NOT NULL AND l."durationSeconds" IS NULL`,
  },
  {
    code: 'OPEN_LOG_WITH_DURATION',
    description: 'An open time log already has a durationSeconds.',
    unit: 'logs',
    sql: `SELECT l.id AS ref, t."ticketId" AS ticket_key, 'endedAt null, durationSeconds set' AS detail
      FROM ticket_time_logs l JOIN tickets t ON t.id = l."ticketId"
      WHERE l."endedAt" IS NULL AND l."durationSeconds" IS NOT NULL`,
  },
  {
    code: 'NEGATIVE_DURATION_OR_INVERTED_RANGE',
    description: 'A time log has a negative duration or ends before it starts.',
    unit: 'logs',
    sql: `SELECT l.id AS ref, t."ticketId" AS ticket_key,
             CASE WHEN l."endedAt" < l."startedAt" THEN 'endedAt before startedAt' ELSE 'negative durationSeconds' END AS detail
      FROM ticket_time_logs l JOIN tickets t ON t.id = l."ticketId"
      WHERE l."durationSeconds" < 0 OR l."endedAt" < l."startedAt"`,
  },
  {
    code: 'OVERLAPPING_ASSIGNEE_RANGES',
    description: 'Two productive ASSIGNEE ranges of the same user overlap in time.',
    unit: 'pairs',
    sql: `SELECT a.id || '/' || b.id AS ref, NULL::text AS ticket_key,
             ta."ticketId" || ' overlaps ' || tb."ticketId" AS detail
      FROM ticket_time_logs a
      JOIN ticket_time_logs b
        ON b."userId" = a."userId" AND a.id < b.id
       AND b."ownerType" = 'ASSIGNEE' AND b."countsAsWork"
       AND a."startedAt" < coalesce(b."endedAt", $1::timestamp)
       AND b."startedAt" < coalesce(a."endedAt", $1::timestamp)
      JOIN tickets ta ON ta.id = a."ticketId"
      JOIN tickets tb ON tb.id = b."ticketId"
      WHERE a."ownerType" = 'ASSIGNEE' AND a."countsAsWork"`,
  },
  {
    code: 'ACTIVE_REWORK_LOG_WITHOUT_OPEN_CYCLE',
    description: 'An active REWORK log exists on a ticket with no open rework cycle.',
    unit: 'logs',
    sql: `WITH ${ACTIVE}, ${OPEN_REWORK}
      SELECT a.id AS ref, a.ticket_key, 'REWORK log with no open rework cycle' AS detail
      FROM active a
      WHERE a.stage = 'REWORK' AND NOT EXISTS (SELECT 1 FROM open_rework c WHERE c."ticketId" = a."ticketId")`,
  },
  {
    code: 'WORK_LOG_INSIDE_REWORK_CYCLE',
    description:
      'A productive WORK-stage ASSIGNEE log starts inside a rework cycle, where it should be REWORK. Non-productive markers are ignored.',
    unit: 'logs',
    sql: `SELECT l.id AS ref, t."ticketId" AS ticket_key, 'WORK log inside rework cycle ' || c."cycleNo"::text AS detail
      FROM ticket_time_logs l
      JOIN tickets t ON t.id = l."ticketId"
      JOIN review_cycle_logs c
        ON c."ticketId" = l."ticketId" AND c.decision = 'REWORK' AND c."reworkStartedAt" IS NOT NULL
       AND l."startedAt" >= c."reworkStartedAt"
       AND (c."reworkEndedAt" IS NULL OR l."startedAt" < c."reworkEndedAt")
      WHERE l."ownerType" = 'ASSIGNEE' AND l.stage = 'WORK' AND l."countsAsWork"`,
  },
  {
    code: 'REWORK_CYCLE_MULTIPLE_ACTIVE_SEGMENTS',
    description: 'An open rework cycle has more than one active timer segment.',
    unit: 'cycles',
    sql: `WITH ${ACTIVE}, ${OPEN_REWORK}
      SELECT c.id AS ref, min(a.ticket_key) AS ticket_key, count(*)::text || ' active segments' AS detail
      FROM open_rework c JOIN active a ON a."ticketId" = c."ticketId"
      GROUP BY c.id HAVING count(*) > 1`,
  },
  // ── Phase 4: reviewer active-work clock ──────────────────────────────────
  {
    code: 'DUPLICATE_ACTIVE_TIMED_LOGS',
    description:
      'A user has more than one active timed log across employee (ASSIGNEE) and reviewer (REVIEWER) timers (one timed ticket per user).',
    unit: 'users',
    sql: `SELECT l."userId" AS ref, NULL::text AS ticket_key,
             count(*)::text || ' active timed logs: ' ||
             string_agg(l."ownerType" || ' ' || t."ticketId", ',' ORDER BY l."ownerType", t."ticketId") AS detail
      FROM ticket_time_logs l JOIN tickets t ON t.id = l."ticketId"
      WHERE l."endedAt" IS NULL AND l."ownerType" IN ('ASSIGNEE', 'REVIEWER')
      GROUP BY l."userId" HAVING count(*) > 1`,
  },
  {
    code: 'ACTIVE_REVIEWER_LOG_TICKET_NOT_IN_REVIEW',
    description: 'An active REVIEWER log is on a ticket that is not in REVIEW.',
    unit: 'logs',
    sql: `WITH ${ACTIVE_REVIEWER}
      SELECT id AS ref, ticket_key, 'ticket status ' || ticket_status AS detail
      FROM active_reviewer WHERE ticket_status <> 'REVIEW'`,
  },
  {
    code: 'ACTIVE_REVIEWER_LOG_WITHOUT_OPEN_REVIEW_CYCLE',
    description: 'An active REVIEWER log is on a ticket with no open (undecided) review cycle.',
    unit: 'logs',
    sql: `WITH ${ACTIVE_REVIEWER}
      SELECT a.id AS ref, a.ticket_key, 'no open review cycle' AS detail
      FROM active_reviewer a
      WHERE NOT EXISTS (
        SELECT 1 FROM review_cycle_logs c WHERE c."ticketId" = a."ticketId" AND c.decision IS NULL)`,
  },
  {
    code: 'ACTIVE_REVIEWER_LOG_USER_NOT_WORKING',
    description:
      'An active REVIEWER log belongs to a user who is not WORKING (on break, idle, logged out, or with no open WORKING session).',
    unit: 'logs',
    sql: `WITH ${ACTIVE_REVIEWER}
      SELECT a.id AS ref, a.ticket_key,
             'user status ' || coalesce(a.user_status, 'NULL') ||
             CASE WHEN ws.id IS NULL THEN ', no open WORKING session' ELSE '' END AS detail
      FROM active_reviewer a
      LEFT JOIN LATERAL (
        SELECT s.id FROM work_sessions s
        WHERE s."userId" = a."userId" AND s."logoutAt" IS NULL AND s.status = 'WORKING'
        LIMIT 1
      ) ws ON TRUE
      WHERE a.user_status IS DISTINCT FROM 'WORKING' OR ws.id IS NULL`,
  },
  {
    code: 'ACTIVE_REVIEWER_LOG_WITH_INVALID_WORK_SESSION',
    description:
      'An active REVIEWER log has no linked WorkSession, or one that belongs to another user, is closed, or was superseded by a later-dated session.',
    unit: 'logs',
    sql: `WITH ${ACTIVE_REVIEWER}
      SELECT a.id AS ref, a.ticket_key,
             CASE
               WHEN s.id IS NULL THEN 'no linked work session'
               WHEN s."userId" IS DISTINCT FROM a."userId" THEN 'linked session belongs to another user'
               WHEN s."logoutAt" IS NOT NULL OR s.status IN ('LOGGED_OUT', 'AUTO_CLOSED')
                 THEN 'session closed (' || s.status || ')'
               ELSE 'session superseded by a later session'
             END AS detail
      FROM active_reviewer a
      LEFT JOIN work_sessions s ON s.id = a."workSessionId"
      WHERE s.id IS NULL
         OR s."userId" IS DISTINCT FROM a."userId"
         OR s."logoutAt" IS NOT NULL
         OR s.status IN ('LOGGED_OUT', 'AUTO_CLOSED')
         OR EXISTS (SELECT 1 FROM work_sessions n WHERE n."userId" = a."userId" AND n.date > s.date)`,
  },
  {
    code: 'REVIEWER_LOG_WRONG_STAGE',
    description: 'A REVIEWER log has a stage other than REVIEW (reviewer time must never look like employee WORK/REWORK).',
    unit: 'logs',
    sql: `SELECT l.id AS ref, t."ticketId" AS ticket_key, 'stage ' || l.stage AS detail
      FROM ticket_time_logs l JOIN tickets t ON t.id = l."ticketId"
      WHERE l."ownerType" = 'REVIEWER' AND l.stage <> 'REVIEW'`,
  },
  {
    code: 'OVERLAPPING_TIMED_RANGES',
    description:
      'A productive REVIEWER range overlaps another productive timed range (employee or reviewer) of the same user.',
    unit: 'pairs',
    sql: `SELECT a.id || '/' || b.id AS ref, NULL::text AS ticket_key,
             ta."ticketId" || ' (' || a."ownerType" || ') overlaps ' || tb."ticketId" || ' (' || b."ownerType" || ')' AS detail
      FROM ticket_time_logs a
      JOIN ticket_time_logs b
        ON b."userId" = a."userId" AND a.id < b.id
       AND b."ownerType" IN ('ASSIGNEE', 'REVIEWER') AND b."countsAsWork"
       AND (a."ownerType" = 'REVIEWER' OR b."ownerType" = 'REVIEWER')
       AND a."startedAt" < coalesce(b."endedAt", $1::timestamp)
       AND b."startedAt" < coalesce(a."endedAt", $1::timestamp)
      JOIN tickets ta ON ta.id = a."ticketId"
      JOIN tickets tb ON tb.id = b."ticketId"
      WHERE a."ownerType" IN ('ASSIGNEE', 'REVIEWER') AND a."countsAsWork"`,
  },
  {
    code: 'EMPLOYEE_WORK_CONTRADICTS_STATE',
    description:
      'The ticket would report activeClock EMPLOYEE_WORK while its status, block, assignee or the worker state says it cannot be running.',
    unit: 'tickets',
    sql: `WITH ${ACTIVE}
      SELECT "ticketId" AS ref, min(ticket_key) AS ticket_key,
             string_agg(DISTINCT reason, ', ' ORDER BY reason) AS detail
      FROM (
        SELECT "ticketId", ticket_key, 'status ' || ticket_status AS reason FROM active WHERE ticket_status <> 'IN_PROGRESS'
        UNION ALL SELECT "ticketId", ticket_key, 'blocked' FROM active WHERE is_blocked
        UNION ALL SELECT "ticketId", ticket_key, 'unassigned' FROM active WHERE assigned_to IS NULL
        UNION ALL SELECT "ticketId", ticket_key, 'not primary assignee' FROM active WHERE assigned_to <> "userId"
        UNION ALL SELECT "ticketId", ticket_key, 'worker ' || coalesce(user_status, 'NULL') FROM active
          WHERE user_status IS DISTINCT FROM 'WORKING'
      ) r
      GROUP BY "ticketId"`,
  },
];

/** The minimal client surface the audit needs: raw SELECTs only. */
export interface QueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

interface TransactionalClient {
  $transaction<R>(
    fn: (tx: QueryClient & { $executeRawUnsafe(query: string): Promise<unknown> }) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R>;
}

/**
 * The only entry point that touches a database: one transaction, declared
 * READ ONLY before the first SELECT, so the server refuses any write.
 */
export async function runReadOnlyAudit(prisma: TransactionalClient, options: AuditOptions): Promise<AuditReport> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '60s'`);
      return runChecks(tx, options);
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

const LOOPBACK_ADDR = new Set(['127.0.0.1', '::1']);

export interface ServerIdentity {
  db: string;
  addr: string | null;
  port: string;
  version: string;
  read_only: string;
}

/**
 * Gate two: the server, not the URL, says where we are. Shared with the
 * Phase 2D1 cleanup tool so both refuse exactly the same servers.
 */
export async function assertTargetServer(client: QueryClient): Promise<ServerIdentity> {
  const [who] = await client.$queryRawUnsafe<any[]>(
    `SELECT current_database() AS db, host(inet_server_addr()) AS addr,
            inet_server_port()::text AS port, current_setting('server_version') AS version,
            current_setting('transaction_read_only') AS read_only`,
  );
  if (who.db !== AUDIT_DB_NAME) {
    throw new AuditConfigError(`Server reports database "${who.db}", refusing to continue.`);
  }
  if (who.addr && !LOOPBACK_ADDR.has(String(who.addr))) {
    throw new AuditConfigError(`Server reports address "${who.addr}", which is not loopback.`);
  }
  return who;
}

/** Runs every check against `client`, which must already be in a read-only transaction. */
export async function runChecks(client: QueryClient, options: AuditOptions): Promise<AuditReport> {
  const who = await assertTargetServer(client);
  if (who.read_only !== 'on') {
    throw new AuditConfigError('The audit transaction is not read-only; refusing to query.');
  }

  const nowIso = options.now.toISOString();
  const staleIso = new Date(options.now.getTime() - options.staleHours * 3600_000).toISOString();

  const [totals] = await client.$queryRawUnsafe<any[]>(
    `SELECT (SELECT count(*) FROM ticket_time_logs)::int AS logs,
            count(*)::int AS active,
            count(DISTINCT "ticketId")::int AS tickets,
            count(DISTINCT "userId")::int AS users
     FROM ticket_time_logs WHERE "ownerType" = 'ASSIGNEE' AND "endedAt" IS NULL`,
  );

  const checks: CheckResult[] = [];
  for (const def of CHECKS) {
    // Every check receives both parameters; the outer predicate types them even
    // for checks that do not use them, which PostgreSQL otherwise rejects.
    const typed = `$1::timestamp IS NOT NULL AND $2::timestamp IS NOT NULL`;
    const rows = await client.$queryRawUnsafe<any[]>(
      `SELECT count(*) OVER ()::int AS total, q.ref, q.ticket_key, q.detail
       FROM (${def.sql}) q WHERE ${typed} ORDER BY q.ref LIMIT ${Math.max(0, Math.floor(options.sampleLimit))}`,
      nowIso,
      staleIso,
    );
    const count = options.sampleLimit > 0
      ? rows[0]?.total ?? 0
      : (await client.$queryRawUnsafe<any[]>(
          `SELECT count(*)::int AS n FROM (${def.sql}) q WHERE ${typed}`,
          nowIso,
          staleIso,
        ))[0].n;
    checks.push({
      code: def.code,
      description: def.description,
      unit: def.unit,
      count,
      samples: rows.map((r) => ({ ref: String(r.ref), ticketKey: r.ticket_key ?? null, detail: String(r.detail) })),
    });
  }

  const violationTotal = checks.reduce((n, c) => n + c.count, 0);
  return {
    result: violationTotal === 0 ? 'CLEAN' : 'VIOLATIONS_FOUND',
    auditedAt: nowIso,
    database: {
      name: who.db,
      address: who.addr ?? null,
      port: String(who.port),
      serverVersion: String(who.version).split(' ')[0],
    },
    options: { staleHours: options.staleHours, sampleLimit: options.sampleLimit },
    totals: {
      timeLogs: totals.logs,
      activeAssigneeLogs: totals.active,
      ticketsWithActiveLog: totals.tickets,
      usersWithActiveLog: totals.users,
    },
    violationTotal,
    checks,
  };
}

// ── Exit codes and output ────────────────────────────────────────────────────

export const EXIT_CLEAN = 0;
export const EXIT_FAILURE = 1;
export const EXIT_VIOLATIONS = 2;

export function exitCodeFor(report: AuditReport): number {
  return report.result === 'CLEAN' ? EXIT_CLEAN : EXIT_VIOLATIONS;
}

export function formatHuman(report: AuditReport): string {
  const lines = [
    `Ticket timer integrity audit: ${report.result}`,
    `  database  ${report.database.name} @ ${report.database.address ?? 'local socket'}:${report.database.port} (PostgreSQL ${report.database.serverVersion})`,
    `  audited   ${report.auditedAt}  (stale threshold ${report.options.staleHours}h)`,
    `  checked   ${report.totals.timeLogs} time logs, ${report.totals.activeAssigneeLogs} active ASSIGNEE logs ` +
      `on ${report.totals.ticketsWithActiveLog} tickets for ${report.totals.usersWithActiveLog} users`,
    '',
  ];
  for (const c of report.checks) {
    lines.push(`  ${c.count === 0 ? 'ok  ' : 'FAIL'}  ${c.code}: ${c.count} ${c.unit}`);
    for (const s of c.samples) {
      lines.push(`          - ${s.ref}${s.ticketKey ? ` [${s.ticketKey}]` : ''}: ${s.detail}`);
    }
    if (c.count > c.samples.length) lines.push(`          … ${c.count - c.samples.length} more`);
  }
  lines.push('', `  ${report.violationTotal} violation(s) across ${report.checks.filter((c) => c.count > 0).length} check(s).`);
  return lines.join('\n');
}

// ── Arguments ────────────────────────────────────────────────────────────────

export interface CliArgs {
  json: boolean;
  options: AuditOptions;
}

export function parseArgs(argv: string[], clock: () => Date = () => new Date()): CliArgs {
  let json = false;
  let staleHours = 12;
  let sampleLimit = 20;
  let now = clock();
  for (const arg of argv) {
    const [key, value] = arg.split('=', 2);
    if (key === '--json') json = true;
    else if (key === '--stale-hours') staleHours = positiveNumber(key, value);
    else if (key === '--sample') sampleLimit = Math.min(200, Math.floor(positiveNumber(key, value, true)));
    else if (key === '--now') {
      now = new Date(value ?? '');
      if (Number.isNaN(now.getTime())) throw new AuditConfigError('--now must be an ISO timestamp.');
    } else if (key === '--apply' || key === '--fix' || key === '--repair') {
      throw new AuditConfigError(`${key} is not supported: this audit is read-only and has no repair mode.`);
    } else {
      throw new AuditConfigError(`Unknown argument "${key}".`);
    }
  }
  return { json, options: { now, staleHours, sampleLimit } };
}

function positiveNumber(key: string, value: string | undefined, allowZero = false): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) {
    throw new AuditConfigError(`${key} must be a ${allowZero ? 'non-negative' : 'positive'} number.`);
  }
  return n;
}
