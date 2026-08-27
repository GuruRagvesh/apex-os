/**
 * Restore test.
 *
 *   npm run backup:restore-test -- --key=database/daily/2026/08/apex-os-....dump
 *   npm run backup:restore-test                # newest daily backup
 *
 * A backup nobody has restored is a hypothesis. This turns it into a fact:
 * fetch the object, prove the bytes are the bytes that were taken, restore into
 * a throwaway database, and count what came back.
 *
 * It is NOT a production recovery tool. The destination guard fails closed in
 * the opposite direction to the backup job: backing up must prove the target IS
 * production, restoring must prove it is NOT, and an unrecognised database is
 * refused rather than assumed safe.
 *
 * Required environment:
 *
 *   RESTORE_TARGET_DATABASE_URL   an isolated, disposable database
 *   R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
 *
 * APP_ENV must NOT be production. EXPECTED_PRODUCTION_DB_* are read if present
 * so the destination can be checked against them by name as well as by marker.
 */

import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { redactSecrets, runPgTool, toPgTarget } from './pg-connection';
import { assertNonProductionTarget, TargetRefused } from './backup-identity';
import type { BackupManifest } from './backup-manifest';
import { createR2Vault, readR2Config, sha256File, type Vault } from './r2-vault';
import {
  planSchemaExpectations,
  readMigrationTableMap,
  verifySchema,
  type SchemaVerdict,
  type TableExpectation,
} from './schema-expectations';

export interface RestoreCheck {
  table: string;
  present: boolean;
  rowCount: number | null;
  error: string | null;
}

export interface RestoreReport {
  objectKey: string;
  byteSize: number;
  expectedSha256: string | null;
  actualSha256: string;
  checksumVerified: boolean;
  restored: boolean;
  /** Migrations the RESTORED database records, not the working tree's. */
  appliedMigrations: string[];
  expectations: TableExpectation[];
  schema: SchemaVerdict | null;
  checks: RestoreCheck[];
  migrationCount: number | null;
  passed: boolean;
  failureReason: string | null;
}

/**
 * Refuses a destination that is production, or that cannot prove it is not.
 *
 * "Different from the current DATABASE_URL" is deliberately NOT the test: on a
 * machine where DATABASE_URL happens to be unset or stale, that comparison
 * passes against production.
 */
export function assertSafeRestoreTarget(env: NodeJS.ProcessEnv): { host: string; database: string } {
  const target = assertNonProductionTarget(env);

  const prodHost = (env.EXPECTED_PRODUCTION_DB_HOST ?? '').trim();
  const prodName = (env.EXPECTED_PRODUCTION_DB_NAME ?? '').trim();
  if (prodHost && target.host === prodHost) {
    throw new TargetRefused('Restore target host equals EXPECTED_PRODUCTION_DB_HOST.');
  }
  if (prodName && target.database === prodName) {
    throw new TargetRefused('Restore target database equals EXPECTED_PRODUCTION_DB_NAME.');
  }
  return target;
}

export interface RestoreDeps {
  vault: Vault;
  restore: (databaseUrl: string, dumpPath: string) => Promise<void>;
  countRows: (databaseUrl: string, table: string) => Promise<number>;
  /** Table names the restored database actually has. */
  listTables: (databaseUrl: string) => Promise<string[]>;
  /** Migration names the restored database records as applied. */
  listAppliedMigrations: (databaseUrl: string) => Promise<string[]>;
  /** Which tables each migration creates. Injected so tests need no fixtures. */
  migrationTables: () => Record<string, string[]>;
  now: () => Date;
}

export async function runRestoreTest(
  env: NodeJS.ProcessEnv,
  objectKey: string,
  expectedSha256: string | null,
  deps: RestoreDeps,
): Promise<RestoreReport> {
  const target = assertSafeRestoreTarget(env);
  const targetUrl = env.RESTORE_TARGET_DATABASE_URL!;

  // Anything that ends up in the report is printed, so every error captured
  // below is scrubbed. Prisma and libpq both echo connection details in some
  // failures, and the report is the last place that text passes through.
  const secret = (() => {
    try {
      return toPgTarget(targetUrl).password;
    } catch {
      return null;
    }
  })();
  const safe = (text: string) => redactSecrets(text, [secret]);

  const dir = mkdtempSync(join(tmpdir(), 'apex-restore-'));
  const dumpPath = join(dir, 'restore.dump');

  const report: RestoreReport = {
    objectKey,
    byteSize: 0,
    expectedSha256,
    actualSha256: '',
    checksumVerified: false,
    restored: false,
    appliedMigrations: [],
    expectations: [],
    schema: null,
    checks: [],
    migrationCount: null,
    passed: false,
    failureReason: null,
  };

  try {
    await deps.vault.getToFile(objectKey, dumpPath);
    report.byteSize = statSync(dumpPath).size;
    report.actualSha256 = await sha256File(dumpPath);

    if (expectedSha256) {
      // A mismatch means the bytes are not the bytes that were taken. Restoring
      // them would prove nothing about the backup and could silently seed the
      // test database with something else entirely.
      if (report.actualSha256 !== expectedSha256) {
        report.failureReason =
          'Checksum mismatch: the downloaded object is not the object that was backed up.';
        return report;
      }
      report.checksumVerified = true;
    }

    await deps.restore(targetUrl, dumpPath);
    report.restored = true;

    // What this backup CLAIMS to be. Read from the restored database, never
    // from the working tree: the repository has moved on, the backup has not.
    report.appliedMigrations = await deps.listAppliedMigrations(targetUrl);
    report.migrationCount = report.appliedMigrations.length;

    if (report.migrationCount === 0) {
      // A restore with no migration history is a schema of unknown provenance.
      report.failureReason = 'Restored database has no Prisma migration history.';
      return report;
    }

    report.expectations = planSchemaExpectations(
      report.appliedMigrations,
      deps.migrationTables(),
    );

    const present = new Set(await deps.listTables(targetUrl));
    report.schema = verifySchema(report.expectations, present);

    if (!report.schema.passed) {
      // A table its own migration claims to have created is genuinely missing.
      report.failureReason =
        `${report.schema.missing.length} table(s) missing that the restored migration ` +
        `history requires: ${report.schema.missing.map((m) => m.table).join(', ')}`;
      return report;
    }

    // Counts, for the tables that should exist. No row content is read, so no
    // employee data reaches a log.
    for (const expectation of report.expectations) {
      if (expectation.requirement === 'NOT_APPLICABLE') continue;
      try {
        report.checks.push({
          table: expectation.table,
          present: true,
          rowCount: await deps.countRows(targetUrl, expectation.table),
          error: null,
        });
      } catch (err: any) {
        report.checks.push({
          table: expectation.table,
          present: false,
          rowCount: null,
          error: safe(err?.message ?? String(err)),
        });
      }
    }

    const unreadable = report.checks.filter((c) => !c.present);
    if (unreadable.length > 0) {
      report.failureReason = `${unreadable.length} table(s) exist but could not be read: ${unreadable
        .map((m) => m.table)
        .join(', ')}`;
      return report;
    }

    report.passed = true;
    return report;
  } catch (err: any) {
    report.failureReason = safe(err?.message ?? String(err));
    return report;
  } finally {
    rmSync(dir, { recursive: true, force: true });
    void target;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Real dependencies
// ─────────────────────────────────────────────────────────────────────────────

async function pgRestore(databaseUrl: string, dumpPath: string): Promise<void> {
  // The password goes through PGPASSWORD, never into argv: an exec error's
  // message embeds the whole command, which is how a failed restore printed a
  // live password into the terminal.
  const target = toPgTarget(databaseUrl);
  // --clean --if-exists so a repeated restore into the same scratch database
  // is idempotent rather than colliding on existing objects.
  await runPgTool(
    'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--dbname',
      target.safeConnectionString,
      dumpPath,
    ],
    target,
  );
}

/** Table names the restored database actually has. */
async function listTables(databaseUrl: string): Promise<string[]> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    return rows.map((r) => r.tablename);
  } finally {
    await prisma.$disconnect();
  }
}

/** Migrations the RESTORED database records, in the order they ran. */
async function listAppliedMigrations(databaseUrl: string): Promise<string[]> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at ASC
    `;
    return rows.map((r) => r.migration_name);
  } finally {
    await prisma.$disconnect();
  }
}

async function countRows(databaseUrl: string, table: string): Promise<number> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    // Identifier is from the fixed INTEGRITY_TABLES list, never user input.
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
    );
    return Number(rows[0]?.count ?? 0);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const keyArg = process.argv.find((a) => a.startsWith('--key='));

  (async () => {
    console.log('── Apex OS restore test ───────────────────────────────────────');

    const vault = createR2Vault(readR2Config(process.env));

    let objectKey = keyArg?.split('=')[1];
    let expectedSha: string | null = null;

    if (!objectKey) {
      const daily = await vault.list('database/daily/');
      if (daily.length === 0) throw new Error('No daily backups found in the vault.');
      daily.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
      objectKey = daily[0].key;
      console.log('  selected        : newest daily backup');
    }

    // The manifest carries the checksum taken at backup time. Without it the
    // download can still be restored, but nothing proves it is unchanged.
    try {
      const manifests = await vault.list('manifests/');
      const dir = mkdtempSync(join(tmpdir(), 'apex-manifest-'));
      for (const m of manifests) {
        const local = join(dir, 'm.json');
        await vault.getToFile(m.key, local);
        const { readFileSync } = await import('fs');
        const parsed: BackupManifest = JSON.parse(readFileSync(local, 'utf8'));
        if (parsed.objectKey === objectKey && parsed.sha256) {
          expectedSha = parsed.sha256;
          break;
        }
      }
      rmSync(dir, { recursive: true, force: true });
    } catch {
      console.warn('  manifest        : not found; checksum cannot be verified');
    }

    console.log(`  object          : ${objectKey}`);
    console.log(`  checksum known  : ${expectedSha ? 'yes' : 'no'}`);

    const report = await runRestoreTest(process.env, objectKey, expectedSha, {
      vault,
      restore: pgRestore,
      countRows,
      listTables,
      listAppliedMigrations,
      migrationTables: () => readMigrationTableMap(join(__dirname, '..', '..', 'prisma', 'migrations')),
      now: () => new Date(),
    });

    console.log('\n  RESTORE');
    console.log(`    bytes         : ${report.byteSize}`);
    console.log(`    checksum      : ${report.checksumVerified ? 'VERIFIED' : 'not verified'}`);
    console.log(`    restored      : ${report.restored}`);

    console.log('\n  SCHEMA AT BACKUP');
    console.log(`    migrations    : ${report.migrationCount ?? '(none)'}`);
    if (report.appliedMigrations.length > 0) {
      console.log(`    latest        : ${report.appliedMigrations[report.appliedMigrations.length - 1]}`);
    }

    if (report.schema) {
      console.log('\n  BASELINE INTEGRITY');
      for (const c of report.checks) {
        const e = report.expectations.find((x) => x.table === c.table);
        if (e?.requirement !== 'BASELINE') continue;
        console.log(`    ${c.present ? '✓' : '✗'} ${c.table.padEnd(30)} ${c.rowCount ?? c.error}`);
      }

      const fromMigration = report.checks.filter(
        (c) => report.expectations.find((x) => x.table === c.table)?.requirement === 'REQUIRED_BY_MIGRATION',
      );
      if (fromMigration.length > 0) {
        console.log('\n  RELEASE SCHEMA (required by applied migrations)');
        for (const c of fromMigration) {
          console.log(`    ${c.present ? '✓' : '✗'} ${c.table.padEnd(30)} ${c.rowCount ?? c.error}`);
        }
      }

      const future = report.expectations.filter((e) => e.requirement === 'NOT_APPLICABLE');
      if (future.length > 0) {
        console.log('\n  FUTURE SCHEMA (not part of this backup)');
        for (const e of future) {
          // Absence here is the correct state, not a finding.
          console.log(`    – ${e.table.padEnd(30)} NOT APPLICABLE — migration not present at backup time`);
        }
      }
    }

    if (!report.passed) {
      console.error(`\nRESTORE TEST FAILED: ${report.failureReason}\n`);
      process.exit(1);
    }
    console.log('\nRESTORE TEST PASSED. This backup is proven usable.\n');
  })().catch((err) => {
    console.error('\nRESTORE TEST ABORTED:', err?.message ?? err);
    process.exit(1);
  });
}
