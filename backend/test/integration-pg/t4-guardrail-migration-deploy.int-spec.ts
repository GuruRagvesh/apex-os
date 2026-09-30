/**
 * Phase 2D1 migration through the REAL `prisma migrate deploy` path, not by
 * executing its statements: duplicate active employee timers make the deploy
 * fail, the failure is recorded, and the documented recovery works
 * (cleanup → `prisma migrate resolve --rolled-back` → deploy).
 *
 * To reproduce a pre-migration database it removes the migration's
 * _prisma_migrations row and the index from the dedicated integration
 * database, and always leaves the migration applied and the index valid.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import { ONE_ACTIVE_INDEX, oneActiveIndexState } from './one-active-index';
import { runCleanupApply } from '../../scripts/lib/ticket-time-cleanup';
import { runReadOnlyAudit } from '../../scripts/lib/ticket-time-integrity';

const MIGRATION = '20261001000000_one_active_assignee_timer';
const W = 'u-deploy-worker';
const REPAIR_AT = new Date('2026-08-13T06:00:00.000Z');

describe('T4 one-active-timer migration via prisma migrate deploy (PostgreSQL)', () => {
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

  async function fingerprint() {
    const [row] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM ticket_time_logs t`,
    );
    return row.h as string;
  }

  /** Whatever happened, leave the migration applied and the index valid. */
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

  it('fails on duplicates, records the failure, and recovers with cleanup → resolve --rolled-back → deploy', async () => {
    // ── A database from before the guardrail, with a duplicate active timer.
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${ONE_ACTIVE_INDEX}"`);
    await prisma.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE migration_name = '${MIGRATION}'`);
    await prisma.role.create({ data: { id: 'r-deploy', name: 'EMPLOYEE', level: 4 } as any });
    await prisma.user.create({
      data: { id: W, roleId: 'r-deploy', name: 'n', email: `${W}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'WORKING' } as any,
    });
    await prisma.workSession.create({
      data: { id: 's-deploy', userId: W, date: new Date('2026-08-13T00:00:00Z'), status: 'WORKING', startWorkAt: new Date('2026-08-13T03:30:00Z') },
    });
    for (const [id, key] of [['t-d1', 'TKT-D-1'], ['t-d2', 'TKT-D-2']]) {
      await prisma.ticket.create({
        data: { id, ticketId: key, title: key, category: 'IT', type: 'TASK', createdById: W, assignedToId: W, status: 'IN_PROGRESS' } as any,
      });
    }
    for (const [id, ticketId, start] of [['l-d1', 't-d1', '05:00'], ['l-d2', 't-d2', '05:30']]) {
      await prisma.ticketTimeLog.create({
        data: { id, ticketId, userId: W, stage: 'WORK', ownerType: 'ASSIGNEE', source: 'SYSTEM', workSessionId: 's-deploy', startedAt: new Date(`2026-08-13T${start}:00Z`) } as any,
      });
    }
    const seeded = await fingerprint();

    // ── 1. The real deploy refuses, with the migration's own message.
    const first = cli('migrate', 'deploy');
    expect(first.code).toBe(1);
    expect(first.out).toContain('P3018');
    expect(first.out).toContain('Database error code: P0001');
    expect(first.out).toContain('with more than one active ASSIGNEE timer. Run the ticket-time cleanup');

    // No partial index, no data change, and Prisma recorded a failed attempt.
    expect((await oneActiveIndexState(prisma)).exists).toBe(false);
    expect(await fingerprint()).toBe(seeded);
    const failed = await migrationRows();
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ finished: false, rolled_back: false, steps: 0 });
    expect(failed[0].logs).toContain('more than one active ASSIGNEE timer');

    // ── 2. While the failure is unresolved, deploy and status both refuse.
    const blocked = cli('migrate', 'deploy');
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain('P3009');
    const status = cli('migrate', 'status');
    expect(status.code).toBe(1);
    expect(status.out).toContain(`prisma migrate resolve --rolled-back "${MIGRATION}"`);

    // ── 3. Recovery: cleanup, mark the failed attempt rolled back, deploy again.
    const cleaned = await runCleanupApply(prisma as any, { repairAt: REPAIR_AT, sampleLimit: 5 });
    expect(cleaned).toMatchObject({ result: 'APPLIED', rowsToClose: 1 });
    expect(cleaned.survivors).toEqual([{ userId: W, keptLogId: 'l-d2', keptTicketKey: 'TKT-D-2', closedLogIds: ['l-d1'] }]);

    const resolve = cli('migrate', 'resolve', '--rolled-back', MIGRATION);
    expect(resolve.code).toBe(0);
    expect(resolve.out).toContain(`Migration ${MIGRATION} marked as rolled back.`);

    const deploy = cli('migrate', 'deploy');
    expect(deploy.code).toBe(0);
    expect(deploy.out).toContain('All migrations have been successfully applied.');

    const index = await oneActiveIndexState(prisma);
    expect(index.exists && index.valid).toBe(true);
    expect(index.definition).toBe(
      `CREATE UNIQUE INDEX ${ONE_ACTIVE_INDEX} ON public.ticket_time_logs USING btree ("userId") ` +
        `WHERE (("endedAt" IS NULL) AND ("ownerType" = 'ASSIGNEE'::text))`,
    );
    expect(await migrationRows()).toEqual([
      expect.objectContaining({ finished: false, rolled_back: true, steps: 0 }),
      expect.objectContaining({ finished: true, rolled_back: false, steps: 1 }),
    ]);

    const clean = cli('migrate', 'status');
    expect(clean.code).toBe(0);
    expect(clean.out).toContain('Database schema is up to date!');

    const audit = await runReadOnlyAudit(prisma as any, { now: REPAIR_AT, staleHours: 12, sampleLimit: 5 });
    expect(audit.result).toBe('CLEAN');
  });
});
