/**
 * The attachment-ownership migration through the REAL `prisma migrate deploy`
 * path, from the schema as Phase 4 left it:
 *
 *   20261003000000_attachment_ownership_and_review_evidence
 *
 * To reproduce the pre-follow-up database it removes the migration's objects
 * and its _prisma_migrations row. It always leaves every migration applied.
 *
 * Proves: only this migration is newly applied; the enum, columns, indexes
 * and foreign keys are exactly as designed; legacy rows are classified by
 * their own isPoc flag only (no owner, cycle or lock is invented) and are
 * otherwise unchanged; status is clean.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';

const ATTACH = '20261003000000_attachment_ownership_and_review_evidence';

describe('T13 attachment-ownership migration via prisma migrate deploy (PostgreSQL)', () => {
  let prisma: PrismaService;
  const cwd = path.resolve(__dirname, '../..');
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [cwd] });

  const cli = (...args: string[]) => {
    const r = spawnSync(process.execPath, [prismaCli, ...args], {
      cwd,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      encoding: 'utf8',
      timeout: 120_000,
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
  const x = (sql: string) => prisma.$executeRawUnsafe(sql);

  async function revertToPhase4Schema() {
    await x(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await x(`ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "attachments_uploadedById_fkey"`);
    await x(`ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "attachments_reviewCycleId_fkey"`);
    await x(`DROP INDEX IF EXISTS "attachments_ticketId_createdAt_idx"`);
    await x(`DROP INDEX IF EXISTS "attachments_uploadedById_idx"`);
    await x(`DROP INDEX IF EXISTS "attachments_reviewCycleId_idx"`);
    await x(`ALTER TABLE "attachments" DROP COLUMN IF EXISTS "lockReason", DROP COLUMN IF EXISTS "lockedAt",
             DROP COLUMN IF EXISTS "purpose", DROP COLUMN IF EXISTS "reviewCycleId", DROP COLUMN IF EXISTS "uploadedById"`);
    await x(`DROP TYPE IF EXISTS "AttachmentPurpose"`);
    await x(`DELETE FROM _prisma_migrations WHERE migration_name = '${ATTACH}'`);
  }

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
  });

  afterAll(async () => {
    if (prisma) {
      // Whatever happened, leave every migration applied.
      const applied = await q(`SELECT 1 FROM _prisma_migrations WHERE migration_name = '${ATTACH}' AND finished_at IS NOT NULL`);
      if (applied.length === 0) {
        await x(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
        const dep = cli('migrate', 'deploy');
        if (dep.code !== 0) throw new Error(`could not restore the migration:\n${dep.out}`);
      }
      await x(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
      await prisma.$disconnect();
    }
  });

  it('applies onto legacy attachments, invents no owner, cycle or lock, and leaves status clean', async () => {
    await assertServerIdentity(prisma as any);
    await revertToPhase4Schema();

    // ── Legacy data as production has it: no uploader, no purpose, no cycle.
    await x(`INSERT INTO roles (id, name, level) VALUES ('r-t13', 'EMPLOYEE', 4)`);
    await x(`INSERT INTO users (id, "roleId", name, email, password, "currentStatus", "updatedAt")
             VALUES ('u-t13', 'r-t13', 'u', 'u-t13@integration.invalid', 'not-a-real-hash', 'OFFLINE', now())`);
    await x(`INSERT INTO tickets (id, "ticketId", title, category, type, "createdById", "assignedToId", status, "updatedAt")
             VALUES ('t-t13', 'TKT-T13-1', 't', 'IT', 'TASK', 'u-t13', 'u-t13', 'DONE', now())`);
    await x(`INSERT INTO attachments (id, filename, url, "ticketId", "isPoc", "pocFor")
             VALUES ('a-legacy-poc', 'proof.pdf', 'legacy://proof', 't-t13', true, 't-t13'),
                    ('a-legacy-file', 'notes.txt', 'legacy://notes', 't-t13', false, NULL)`);
    const legacyBefore = await q(`SELECT id, filename, url, "ticketId", "isPoc", "pocFor", "createdAt" FROM attachments ORDER BY id`);

    // ── The real deploy applies exactly this one migration.
    const deploy = cli('migrate', 'deploy');
    expect(deploy.code).toBe(0);
    expect(deploy.out).toContain(`Applying migration \`${ATTACH}\``);
    expect(deploy.out.match(/Applying migration/g)).toHaveLength(1);
    expect(deploy.out).toContain('All migrations have been successfully applied.');
    const last = await q<{ migration_name: string }>(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY finished_at DESC, started_at DESC LIMIT 2`,
    );
    expect(last.map((r) => r.migration_name)).toEqual([ATTACH, '20261002000000_one_active_timed_ticket_per_user']);

    // ── Objects exactly as designed.
    const labels = await q<{ l: string }>(
      `SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'AttachmentPurpose' ORDER BY e.enumsortorder`,
    );
    expect(labels.map((r) => r.l)).toEqual(['REFERENCE', 'GENERAL', 'POC', 'REVIEW_FEEDBACK']);
    const columns = await q<{ column_name: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns
       WHERE table_name = 'attachments' AND column_name IN ('uploadedById', 'reviewCycleId', 'lockedAt', 'lockReason', 'purpose') ORDER BY column_name`,
    );
    expect(columns).toEqual([
      { column_name: 'lockReason', is_nullable: 'YES', column_default: null },
      { column_name: 'lockedAt', is_nullable: 'YES', column_default: null },
      { column_name: 'purpose', is_nullable: 'NO', column_default: `'GENERAL'::"AttachmentPurpose"` },
      { column_name: 'reviewCycleId', is_nullable: 'YES', column_default: null },
      { column_name: 'uploadedById', is_nullable: 'YES', column_default: null },
    ]);
    const indexes = await q<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename = 'attachments' ORDER BY indexname`);
    expect(indexes.map((r) => r.indexname)).toEqual([
      'attachments_pkey', 'attachments_reviewCycleId_idx', 'attachments_ticketId_createdAt_idx', 'attachments_uploadedById_idx',
    ]);
    const fks = await q<{ conname: string; target: string; on_delete: string }>(
      `SELECT conname, confrelid::regclass::text AS target, confdeltype AS on_delete FROM pg_constraint
       WHERE conrelid = 'attachments'::regclass AND contype = 'f' ORDER BY conname`,
    );
    expect(fks).toEqual([
      { conname: 'attachments_reviewCycleId_fkey', target: 'review_cycle_logs', on_delete: 'n' }, // SET NULL
      { conname: 'attachments_ticketId_fkey', target: 'tickets', on_delete: 'c' },               // CASCADE (unchanged)
      { conname: 'attachments_uploadedById_fkey', target: 'users', on_delete: 'r' },             // RESTRICT
    ]);

    // ── Legacy rows: classified by their own isPoc only; nothing invented; nothing else changed.
    expect(await q(
      `SELECT id, purpose::text AS purpose, "uploadedById", "reviewCycleId", "lockedAt", "lockReason" FROM attachments ORDER BY id`,
    )).toEqual([
      { id: 'a-legacy-file', purpose: 'GENERAL', uploadedById: null, reviewCycleId: null, lockedAt: null, lockReason: null },
      { id: 'a-legacy-poc', purpose: 'POC', uploadedById: null, reviewCycleId: null, lockedAt: null, lockReason: null },
    ]);
    expect(await q(`SELECT id, filename, url, "ticketId", "isPoc", "pocFor", "createdAt" FROM attachments ORDER BY id`)).toEqual(legacyBefore);

    // ── The uploader key now protects ownership: a user who uploaded cannot be deleted.
    await x(`UPDATE attachments SET "uploadedById" = 'u-t13' WHERE id = 'a-legacy-file'`);
    await expect(x(`DELETE FROM users WHERE id = 'u-t13'`)).rejects.toThrow(/foreign key/);

    const status = cli('migrate', 'status');
    expect(status.code).toBe(0);
    expect(status.out).toContain('Database schema is up to date!');
  });
});
