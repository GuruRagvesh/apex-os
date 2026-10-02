/**
 * Phase 4 migration through the REAL `prisma migrate deploy` path: a user with
 * an active employee timer AND an active reviewer timer makes the deploy fail
 * safely, nothing partial remains, and the documented recovery works
 * (cleanup → `prisma migrate resolve --rolled-back` → deploy).
 *
 * To reproduce the database as Phase 2D1 left it, it removes the Phase 4
 * migration's _prisma_migrations row and the new index, and recreates the D1
 * ASSIGNEE-only index. It always leaves every migration applied and the new
 * index valid.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { LEGACY_ONE_ACTIVE_INDEX, ONE_ACTIVE_INDEX, oneActiveIndexState } from './one-active-index';
import { runCleanupApply, runCleanupDryRun } from '../../scripts/lib/ticket-time-cleanup';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const MIGRATION = '20261002000000_one_active_timed_ticket_per_user';
const W = 'u-t9-person';
const DAY = '2026-08-13';
const REPAIR_AT = new Date(`${DAY}T07:00:00.000Z`);

describe('T9 one-active-timed-ticket migration via prisma migrate deploy (PostgreSQL)', () => {
  let prisma: PrismaService;
  const cwd = path.resolve(__dirname, '../..');
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [cwd] });

  /** Runs the Prisma CLI against the (already guarded) integration database only. */
  const cli = (...args: string[]) => {
    const r = spawnSync(process.execPath, [prismaCli, ...args], {
      cwd,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      encoding: 'utf8',
      timeout: 120_000,
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  const migrationRows = () =>
    prisma.$queryRawUnsafe<any[]>(
      `SELECT finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back,
              applied_steps_count::int AS steps, coalesce(logs, '') AS logs
       FROM _prisma_migrations WHERE migration_name = '${MIGRATION}' ORDER BY started_at`,
    );
  const legacyIndexExists = async () =>
    (await prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM pg_class WHERE relname = '${LEGACY_ONE_ACTIVE_INDEX}'`)).length > 0;

  async function fingerprint() {
    const [row] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ticket_time_logs t`,
    );
    return row.h as string;
  }

  /** Whatever happened, leave the migration applied and the new index valid. */
  async function ensureMigrated() {
    const rows = await migrationRows();
    const last = rows[rows.length - 1];
    if (last && !last.finished && !last.rolled_back) cli('migrate', 'resolve', '--rolled-back', MIGRATION);
    if (!(await migrationRows()).some((r) => r.finished && !r.rolled_back)) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
      const dep = cli('migrate', 'deploy');
      if (dep.code !== 0) throw new Error(`could not restore the migration:\n${dep.out}`);
    }
  }

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
  });

  afterAll(async () => {
    if (prisma) {
      await ensureMigrated();
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
      await prisma.$disconnect();
    }
  });

  it('fails on an employee + reviewer timer pair, leaves nothing partial, and recovers with cleanup → resolve → deploy', async () => {
    // ── The database as Phase 2D1 left it: the ASSIGNEE-only index, no Phase 4 index.
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${ONE_ACTIVE_INDEX}"`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${LEGACY_ONE_ACTIVE_INDEX}" ON "ticket_time_logs" ("userId") ` +
        `WHERE "endedAt" IS NULL AND "ownerType" = 'ASSIGNEE'`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE migration_name = '${MIGRATION}'`);

    // One person, WORKING, timing their own ticket AND (allowed by the D1 index) reviewing another.
    await prisma.role.create({ data: { id: 'r-t9', name: 'MANAGER', level: 2 } as any });
    await prisma.user.create({
      data: { id: W, roleId: 'r-t9', name: 'n', email: `${W}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'WORKING' } as any,
    });
    await prisma.workSession.create({
      data: { id: 's-t9', userId: W, date: new Date(`${DAY}T00:00:00Z`), status: 'WORKING', startWorkAt: new Date(`${DAY}T03:30:00Z`) },
    });
    await prisma.ticket.create({
      data: { id: 't-own', ticketId: 'TKT-T9-1', title: 'own', category: 'IT', type: 'TASK', createdById: W, assignedToId: W, status: 'IN_PROGRESS' } as any,
    });
    await prisma.ticket.create({
      data: { id: 't-rev', ticketId: 'TKT-T9-2', title: 'review', category: 'IT', type: 'TASK', createdById: W, assignedToId: W, status: 'REVIEW' } as any,
    });
    await prisma.reviewCycleLog.create({ data: { ticketId: 't-rev', cycleNo: 1, assigneeId: W, reviewStartedAt: new Date(`${DAY}T04:00:00Z`) } });
    await prisma.ticketTimeLog.create({
      data: { id: 'l-emp', ticketId: 't-own', userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', workSessionId: 's-t9', startedAt: new Date(`${DAY}T05:00:00Z`) } as any,
    });
    await prisma.ticketTimeLog.create({
      data: { id: 'l-rev', ticketId: 't-rev', userId: W, stage: 'REVIEW', ownerType: 'REVIEWER', source: 'REVIEW_ACTION', workSessionId: 's-t9', startedAt: new Date(`${DAY}T05:30:00Z`) } as any,
    });
    // Completed history must never change.
    await prisma.ticketTimeLog.create({
      data: { id: 'l-hist', ticketId: 't-own', userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', startedAt: new Date(`${DAY}T04:00:00Z`), endedAt: new Date(`${DAY}T04:30:00Z`), durationSeconds: 1800 } as any,
    });
    const seeded = await fingerprint();

    // ── 1. The real deploy refuses, with the migration's own message.
    const first = cli('migrate', 'deploy');
    expect(first.code).toBe(1);
    expect(first.out).toContain('P3018');
    expect(first.out).toContain('Database error code: P0001');
    expect(first.out).toContain('with more than one active timed ticket (employee or reviewer). Run the ticket-time cleanup');

    // ── 2. Nothing partial: no new index, the old guardrail still in place, no data change.
    expect((await oneActiveIndexState(prisma)).exists).toBe(false);
    expect(await legacyIndexExists()).toBe(true);
    expect(await fingerprint()).toBe(seeded);
    const failed = await migrationRows();
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ finished: false, rolled_back: false, steps: 0 });

    const blocked = cli('migrate', 'deploy');
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain('P3009');

    // ── 3. Cleanup: the dry run reports the pair, the apply closes exactly one row.
    const dry = await runCleanupDryRun(prisma as any, { repairAt: REPAIR_AT, sampleLimit: 5 });
    expect(dry).toMatchObject({ result: 'CHANGES_REQUIRED', inspectedActiveRows: 2, rowsToClose: 1 });
    expect(await fingerprint()).toBe(seeded);
    const cleaned = await runCleanupApply(prisma as any, { repairAt: REPAIR_AT, sampleLimit: 5 });
    expect(cleaned).toMatchObject({ result: 'APPLIED', rowsToClose: 1 });
    expect(cleaned.survivors).toEqual([{ userId: W, keptLogId: 'l-rev', keptTicketKey: 'TKT-T9-2', closedLogIds: ['l-emp'] }]);
    const repaired = await prisma.ticketTimeLog.findUnique({ where: { id: 'l-emp' } });
    expect(repaired).toMatchObject({ countsAsWork: false, pauseReason: 'INTEGRITY_REPAIR', durationSeconds: 2 * 3600 });
    expect(await prisma.ticketTimeLog.findUnique({ where: { id: 'l-hist' } })).toMatchObject({ durationSeconds: 1800, countsAsWork: true });

    // ── 4. Resolve the failed attempt as rolled back, deploy again.
    const resolve = cli('migrate', 'resolve', '--rolled-back', MIGRATION);
    expect(resolve.code).toBe(0);
    expect(resolve.out).toContain(`Migration ${MIGRATION} marked as rolled back.`);
    const deploy = cli('migrate', 'deploy');
    expect(deploy.code).toBe(0);
    expect(deploy.out).toContain('All migrations have been successfully applied.');

    // ── 5. The exact index, valid; the old one gone; status clean; audit CLEAN.
    const index = await oneActiveIndexState(prisma);
    expect(index.exists && index.valid).toBe(true);
    expect(index.definition).toBe(
      `CREATE UNIQUE INDEX ${ONE_ACTIVE_INDEX} ON public.ticket_time_logs USING btree ("userId") ` +
        `WHERE (("endedAt" IS NULL) AND ("ownerType" = ANY (ARRAY['ASSIGNEE'::text, 'REVIEWER'::text])))`,
    );
    expect(await legacyIndexExists()).toBe(false);
    expect(await migrationRows()).toEqual([
      expect.objectContaining({ finished: false, rolled_back: true, steps: 0 }),
      expect.objectContaining({ finished: true, rolled_back: false, steps: 1 }),
    ]);
    const status = cli('migrate', 'status');
    expect(status.code).toBe(0);
    expect(status.out).toContain('Database schema is up to date!');
    const audit = await runReadOnlyAudit(prisma as any, { now: REPAIR_AT, staleHours: 12, sampleLimit: 5 });
    expect(audit.result).toBe('CLEAN');

    // ── 6. The database now refuses a second active timed row, across owner types.
    await expect(prisma.ticketTimeLog.create({
      data: { ticketId: 't-own', userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', startedAt: new Date(`${DAY}T06:00:00Z`) } as any,
    })).rejects.toMatchObject({ code: 'P2002' });
  });
});
