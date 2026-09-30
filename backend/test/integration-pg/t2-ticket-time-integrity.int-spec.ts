/**
 * Phase 2C ticket timer integrity audit against real PostgreSQL.
 *
 * Each test builds a CLEAN fixture, corrupts it in exactly one way, and checks
 * that the audit reports exactly the expected invariants and nothing else. The
 * audit is then proven read-only three ways: every table it reads is
 * fingerprinted before and after, a write inside its transaction mode is
 * refused by the server, and the CLI's exit codes and refusals are exercised
 * as a real subprocess — with a password that must never be printed.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { dropOneActiveIndex, restoreOneActiveIndex } from './one-active-index';
import { AuditReport, CHECKS, runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const W = 'u-audit-worker';
const W2 = 'u-audit-worker-2';
const M = 'u-audit-manager';

const NOW = new Date('2026-08-13T06:00:00.000Z');
const at = (iso: string) => new Date(iso);
const TODAY = at('2026-08-13T00:00:00.000Z');
const YESTERDAY = at('2026-08-12T00:00:00.000Z');

const AUDITED_TABLES = ['ticket_time_logs', 'tickets', 'users', 'work_sessions', 'review_cycle_logs', 'break_logs'];

describe('T2 ticket timer integrity audit (PostgreSQL)', () => {
  let prisma: PrismaService;

  const audit = (overrides: Partial<{ staleHours: number; sampleLimit: number }> = {}) =>
    runReadOnlyAudit(prisma as any, { now: NOW, staleHours: 12, sampleLimit: 20, ...overrides });

  const counts = (r: AuditReport) =>
    Object.fromEntries(r.checks.filter((c) => c.count > 0).map((c) => [c.code, c.count]));

  async function fingerprint() {
    const out: Record<string, string> = {};
    for (const table of AUDITED_TABLES) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ${table} t`,
      );
      out[table] = `${row.n}:${row.h}`;
    }
    return out;
  }

  /**
   * CLEAN baseline: W is WORKING in today's open session, running T1
   * (IN_PROGRESS, assigned to W) since 05:00, with one earlier closed segment
   * on T2 yesterday.
   */
  async function seedClean() {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.role.create({ data: { id: 'r-audit', name: 'EMPLOYEE', level: 4 } as any });
    for (const id of [W, W2, M]) {
      await prisma.user.create({
        data: {
          id, roleId: 'r-audit', name: `Person ${id}`, email: `${id}@integration.invalid`,
          password: 'not-a-real-hash', currentStatus: id === W ? 'WORKING' : 'OFFLINE',
        } as any,
      });
    }
    await prisma.workSession.create({
      data: { id: 's-today', userId: W, date: TODAY, loginAt: at('2026-08-13T03:30:00Z'), startWorkAt: at('2026-08-13T03:30:00Z'), status: 'WORKING' },
    });
    for (const [id, key, status] of [['t-1', 'TKT-AUD-1', 'IN_PROGRESS'], ['t-2', 'TKT-AUD-2', 'IN_PROGRESS']]) {
      await prisma.ticket.create({
        data: {
          id, ticketId: key, title: `Audit fixture ${key}`, category: 'IT', type: 'TASK',
          createdById: M, assignedToId: W, status,
        } as any,
      });
    }
    await log({ id: 'l-closed', ticketId: 't-2', startedAt: at('2026-08-12T10:00:00Z'), endedAt: at('2026-08-12T11:00:00Z'), durationSeconds: 3600 });
    await log({ id: 'l-active', ticketId: 't-1', startedAt: at('2026-08-13T05:00:00Z'), workSessionId: 's-today' });
  }

  function log(fields: Record<string, any>) {
    return prisma.ticketTimeLog.create({
      data: { userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', countsAsWork: true, ...fields } as any,
    });
  }

  const openRework = (ticketId: string, startedAt: Date) =>
    prisma.reviewCycleLog.create({
      data: { ticketId, cycleNo: 1, decision: 'REWORK', reviewStartedAt: at('2026-08-13T03:00:00Z'), reviewEndedAt: startedAt, reworkStartedAt: startedAt },
    });

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    // The audit exists to inspect databases from BEFORE the Phase 2D1
    // guardrail, where duplicate active timers are possible, so this suite
    // works without the one-active-timer index and restores it afterwards.
    await dropOneActiveIndex(prisma);
  });

  beforeEach(seedClean);

  afterAll(async () => {
    // Leave the integration database clean for the next suite and for a
    // post-run audit: no timer fixtures survive this file.
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    if (prisma) await restoreOneActiveIndex(prisma);
    await prisma?.$disconnect();
  });

  it('a clean fixture is CLEAN, with totals and server identity', async () => {
    const r = await audit();
    expect(r.result).toBe('CLEAN');
    expect(r.violationTotal).toBe(0);
    expect(r.checks).toHaveLength(CHECKS.length);
    expect(r.totals).toEqual({ timeLogs: 2, activeAssigneeLogs: 1, ticketsWithActiveLog: 1, usersWithActiveLog: 1 });
    expect(r.database.name).toBe('apex_os_attendance_integration');
    expect(r.database.address).toBe('127.0.0.1');
  });

  // [name, corrupt the clean fixture, exactly these violation counts]
  const cases: Array<[string, () => Promise<unknown>, Record<string, number>]> = [
    ['1. two active logs for one user', async () => {
      await log({ id: 'l-dup', ticketId: 't-2', startedAt: at('2026-08-13T05:30:00Z'), workSessionId: 's-today' });
    }, { DUPLICATE_ACTIVE_ASSIGNEE_LOGS: 1, OVERLAPPING_ASSIGNEE_RANGES: 1 }],

    ['2. active log on a PENDING_APPROVAL ticket', async () => {
      await prisma.ticket.update({ where: { id: 't-1' }, data: { status: 'PENDING_APPROVAL' } });
    }, { ACTIVE_LOG_TICKET_NOT_IN_PROGRESS: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['3a. active log on an OPEN ticket', async () => {
      await prisma.ticket.update({ where: { id: 't-1' }, data: { status: 'OPEN' } });
    }, { ACTIVE_LOG_TICKET_NOT_IN_PROGRESS: 1, ACTIVE_LOG_ON_OPEN_REVIEW_DONE_CLOSED: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['3b. active log on a REVIEW ticket', async () => {
      await prisma.ticket.update({ where: { id: 't-1' }, data: { status: 'REVIEW' } });
    }, { ACTIVE_LOG_TICKET_NOT_IN_PROGRESS: 1, ACTIVE_LOG_ON_OPEN_REVIEW_DONE_CLOSED: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['3c. active log on a DONE ticket', async () => {
      await prisma.ticket.update({ where: { id: 't-1' }, data: { status: 'DONE' } });
    }, { ACTIVE_LOG_TICKET_NOT_IN_PROGRESS: 1, ACTIVE_LOG_ON_OPEN_REVIEW_DONE_CLOSED: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['3d. active log on a CLOSED ticket', async () => {
      await prisma.ticket.update({ where: { id: 't-1' }, data: { status: 'CLOSED' } });
    }, { ACTIVE_LOG_TICKET_NOT_IN_PROGRESS: 1, ACTIVE_LOG_ON_OPEN_REVIEW_DONE_CLOSED: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['4. active log on a blocked ticket', async () => {
      await prisma.ticket.update({ where: { id: 't-1' }, data: { isBlocked: true, blockedAt: at('2026-08-13T05:30:00Z') } });
    }, { ACTIVE_LOG_ON_BLOCKED_TICKET: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['5a. active log while the user is ON_BREAK', async () => {
      await prisma.user.update({ where: { id: W }, data: { currentStatus: 'ON_BREAK' } });
      await prisma.workSession.update({ where: { id: 's-today' }, data: { status: 'ON_BREAK' } });
    }, { ACTIVE_LOG_USER_NOT_WORKING: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['5b. active log while the user is IDLE', async () => {
      await prisma.user.update({ where: { id: W }, data: { currentStatus: 'IDLE' } });
      await prisma.workSession.update({ where: { id: 's-today' }, data: { status: 'IDLE' } });
    }, { ACTIVE_LOG_USER_NOT_WORKING: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['5c. active log after the user logged out', async () => {
      await prisma.user.update({ where: { id: W }, data: { currentStatus: 'OFFLINE' } });
      await prisma.workSession.update({ where: { id: 's-today' }, data: { status: 'LOGGED_OUT', logoutAt: at('2026-08-13T05:45:00Z') } });
    }, { ACTIVE_LOG_USER_NOT_WORKING: 1, ACTIVE_LOG_WITH_INVALID_WORK_SESSION: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['6. active log still linked to a previous-day session', async () => {
      await prisma.workSession.create({ data: { id: 's-yesterday', userId: W, date: YESTERDAY, status: 'WORKING' } });
      await prisma.ticketTimeLog.update({ where: { id: 'l-active' }, data: { workSessionId: 's-yesterday' } });
    }, { ACTIVE_LOG_WITH_INVALID_WORK_SESSION: 1 }],

    // The worker stays WORKING in their own open session in 6a/6b, so only the
    // session-link rule can fire.
    ['6a. active log with no linked work session', async () => {
      await prisma.ticketTimeLog.update({ where: { id: 'l-active' }, data: { workSessionId: null } });
    }, { ACTIVE_LOG_WITH_INVALID_WORK_SESSION: 1 }],

    ["6b. active log linked to another employee's work session", async () => {
      await prisma.workSession.create({
        data: { id: 's-other', userId: W2, date: TODAY, loginAt: at('2026-08-13T03:30:00Z'), startWorkAt: at('2026-08-13T03:30:00Z'), status: 'WORKING' },
      });
      await prisma.ticketTimeLog.update({ where: { id: 'l-active' }, data: { workSessionId: 's-other' } });
    }, { ACTIVE_LOG_WITH_INVALID_WORK_SESSION: 1 }],

    ['7. active log owned by someone other than the primary assignee', async () => {
      await prisma.ticket.update({ where: { id: 't-1' }, data: { assignedToId: W2 } });
    }, { ACTIVE_LOG_NOT_PRIMARY_ASSIGNEE: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['8. active log on an unassigned ticket', async () => {
      await prisma.ticket.update({ where: { id: 't-1' }, data: { assignedToId: null } });
    }, { ACTIVE_LOG_ON_UNASSIGNED_TICKET: 1, EMPLOYEE_WORK_CONTRADICTS_STATE: 1 }],

    ['9. active log older than the threshold', async () => {
      await prisma.ticketTimeLog.update({ where: { id: 'l-active' }, data: { startedAt: at('2026-08-12T16:00:00Z') } });
    }, { ACTIVE_LOG_OLDER_THAN_THRESHOLD: 1 }],

    ['10. closed log with no duration', async () => {
      await prisma.ticketTimeLog.update({ where: { id: 'l-closed' }, data: { durationSeconds: null } });
    }, { CLOSED_LOG_MISSING_DURATION: 1 }],

    ['11. open log with a duration', async () => {
      await prisma.ticketTimeLog.update({ where: { id: 'l-active' }, data: { durationSeconds: 60 } });
    }, { OPEN_LOG_WITH_DURATION: 1 }],

    ['12. negative duration and an end before the start', async () => {
      await prisma.ticketTimeLog.update({
        where: { id: 'l-closed' },
        data: { endedAt: at('2026-08-12T09:00:00Z'), durationSeconds: -3600 },
      });
    }, { NEGATIVE_DURATION_OR_INVERTED_RANGE: 1 }],

    ['13. overlapping productive ranges', async () => {
      await log({ id: 'l-overlap', ticketId: 't-2', startedAt: at('2026-08-13T04:30:00Z'), endedAt: at('2026-08-13T05:30:00Z'), durationSeconds: 3600 });
    }, { OVERLAPPING_ASSIGNEE_RANGES: 1 }],

    ['14. active REWORK log with no open rework cycle', async () => {
      await prisma.ticketTimeLog.update({ where: { id: 'l-active' }, data: { stage: 'REWORK' } });
    }, { ACTIVE_REWORK_LOG_WITHOUT_OPEN_CYCLE: 1 }],

    ['15. WORK log inside an open rework cycle', async () => {
      await openRework('t-1', at('2026-08-13T04:00:00Z'));
    }, { WORK_LOG_INSIDE_REWORK_CYCLE: 1 }],

    ['16. two active segments in one rework cycle', async () => {
      await openRework('t-1', at('2026-08-13T04:00:00Z'));
      await prisma.ticketTimeLog.update({ where: { id: 'l-active' }, data: { stage: 'REWORK' } });
      await log({ id: 'l-rework-2', ticketId: 't-1', stage: 'REWORK', startedAt: at('2026-08-13T05:15:00Z'), workSessionId: 's-today' });
    }, { REWORK_CYCLE_MULTIPLE_ACTIVE_SEGMENTS: 1, DUPLICATE_ACTIVE_ASSIGNEE_LOGS: 1, OVERLAPPING_ASSIGNEE_RANGES: 1 }],
  ];

  it.each(cases)('%s', async (_name, corrupt, expected) => {
    await corrupt();
    const r = await audit();
    expect(r.result).toBe('VIOLATIONS_FOUND');
    expect(counts(r)).toEqual(expected);
    expect(r.violationTotal).toBe(Object.values(expected).reduce((a, b) => a + b, 0));
    for (const c of r.checks.filter((x) => x.count > 0)) {
      expect(c.samples.length).toBe(c.count);
    }
  });

  it('17. EMPLOYEE_WORK contradictions are counted once per ticket, with every reason', async () => {
    await prisma.ticket.update({ where: { id: 't-1' }, data: { status: 'OPEN', isBlocked: true } });
    await prisma.user.update({ where: { id: W }, data: { currentStatus: 'ON_BREAK' } });
    const c = (await audit()).checks.find((x) => x.code === 'EMPLOYEE_WORK_CONTRADICTS_STATE')!;
    expect(c.count).toBe(1);
    expect(c.samples[0]).toEqual({ ref: 't-1', ticketKey: 'TKT-AUD-1', detail: 'blocked, status OPEN, worker ON_BREAK' });
  });

  it('zero-length pause markers are ended rows and never flagged', async () => {
    const marker = at('2026-08-13T04:50:00Z');
    await log({ id: 'l-marker', ticketId: 't-2', startedAt: marker, endedAt: marker, durationSeconds: 0, countsAsWork: false, pauseReason: 'AWAITING_WORKDAY' });
    expect((await audit()).result).toBe('CLEAN');
  });

  it('a non-productive WORK marker inside a rework cycle is not rework-stage corruption', async () => {
    // A valid open rework cycle: the running segment is REWORK.
    await openRework('t-1', at('2026-08-13T04:00:00Z'));
    await prisma.ticketTimeLog.update({ where: { id: 'l-active' }, data: { stage: 'REWORK' } });
    const marker = at('2026-08-13T04:30:00Z');
    await log({
      id: 'l-rework-marker', ticketId: 't-1', stage: 'WORK', startedAt: marker, endedAt: marker,
      durationSeconds: 0, countsAsWork: false, pauseReason: 'AWAITING_WORKDAY',
    });
    const r = await audit();
    expect(r.checks.find((c) => c.code === 'WORK_LOG_INSIDE_REWORK_CYCLE')!.count).toBe(0);
    expect(r.result).toBe('CLEAN');
  });

  it('samples are bounded, deterministic, and carry ids and ticket keys only', async () => {
    for (let i = 0; i < 4; i += 1) {
      await log({ id: `l-extra-${i}`, ticketId: 't-2', startedAt: at(`2026-08-13T05:0${i + 1}:00Z`), workSessionId: 's-today' });
    }
    const a = await audit({ sampleLimit: 2 });
    const b = await audit({ sampleLimit: 2 });
    expect(a).toEqual(b);
    const overlap = a.checks.find((c) => c.code === 'OVERLAPPING_ASSIGNEE_RANGES')!;
    expect(overlap.count).toBe(10); // C(5,2) pairs among five concurrent active logs
    expect(overlap.samples).toHaveLength(2);
    const json = JSON.stringify(a);
    expect(json).not.toMatch(/@integration\.invalid|Person u-audit|not-a-real-hash/);
  });

  it('is read-only: no audited table changes, even on a corrupt database', async () => {
    await log({ id: 'l-dup', ticketId: 't-2', startedAt: at('2026-08-13T05:30:00Z'), workSessionId: 's-today' });
    const before = await fingerprint();
    await audit();
    await audit({ sampleLimit: 0 });
    expect(await fingerprint()).toEqual(before);
  });

  it('is read-only: the server refuses a write in the audit transaction mode', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe(`UPDATE users SET "currentStatus" = 'OFFLINE' WHERE id = '${W}'`);
      }),
    ).rejects.toThrow(/read-only transaction/);
    expect((await prisma.user.findUnique({ where: { id: W } }))!.currentStatus).toBe('WORKING');
  });

  describe('CLI', () => {
    const SECRET = 'Sup3r-Secret-Pa55';
    const cwd = path.resolve(__dirname, '../..');
    const tsNode = require.resolve('ts-node/dist/bin.js', { paths: [cwd] });

    const run = (env: Record<string, string | undefined>, args: string[] = []) => {
      const childEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries({ ...process.env, ...env })) if (v !== undefined) childEnv[k] = v;
      if (env.DATABASE_URL === undefined) delete childEnv.DATABASE_URL;
      const r = spawnSync(process.execPath, [tsNode, '--transpile-only', 'scripts/ticket-time-integrity-audit.ts', ...args], {
        cwd, env: childEnv, encoding: 'utf8', timeout: 90_000,
      });
      return { code: r.status, out: `${r.stdout}\n${r.stderr}`, stdout: r.stdout };
    };
    const good = () => process.env.DATABASE_URL as string;
    const withPassword = (url: string) => url.replace('://apex_test@', `://apex_test:${SECRET}@`);

    it('exits 0 with a CLEAN JSON report', () => {
      const r = run({ DATABASE_URL: good() }, ['--json', `--now=${NOW.toISOString()}`]);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).result).toBe('CLEAN');
    });

    it('exits 2 when violations exist', async () => {
      await log({ id: 'l-dup', ticketId: 't-2', startedAt: at('2026-08-13T05:30:00Z'), workSessionId: 's-today' });
      const r = run({ DATABASE_URL: good() }, [`--now=${NOW.toISOString()}`]);
      expect(r.code).toBe(2);
      expect(r.out).toContain('FAIL  DUPLICATE_ACTIVE_ASSIGNEE_LOGS: 1 users');
    });

    it.each([
      ['missing', undefined],
      ['wrong database name', `postgresql://apex_test:${SECRET}@127.0.0.1:55432/apex_os_render_clone_20260928`],
      ['remote host', `postgresql://apex_test:${SECRET}@10.20.30.40:5432/apex_os_attendance_integration`],
      ['Render host', `postgresql://apex_test:${SECRET}@dpg-x.oregon-postgres.render.com/apex_os_attendance_integration`],
      ['malformed', `postgres//apex_test:${SECRET}@@`],
    ])('exits 1 and refuses a %s URL without printing the password', (_label, url) => {
      const r = run({ DATABASE_URL: url });
      expect(r.code).toBe(1);
      expect(r.out).toContain('ticket-time audit refused');
      expect(r.out).not.toContain(SECRET);
    });

    it('exits 1 on a connection failure without printing the password', () => {
      const unreachable = withPassword(good()).replace(/:\d+\//, ':1/');
      const r = run({ DATABASE_URL: unreachable });
      expect(r.code).toBe(1);
      expect(r.out).toContain('ticket-time audit failed');
      expect(r.out).not.toContain(SECRET);
    });

    it('exits 1 on a repair flag', () => {
      const r = run({ DATABASE_URL: good() }, ['--apply']);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/read-only and has no repair mode/);
    });
  });
});
