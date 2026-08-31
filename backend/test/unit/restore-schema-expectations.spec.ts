import { writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  BASELINE_TABLES,
  planSchemaExpectations,
  readMigrationTableMap,
  verifySchema,
} from '../../scripts/backup/schema-expectations';
import { runRestoreTest, type RestoreDeps } from '../../scripts/backup/run-restore-test';
import type { Vault } from '../../src/modules/platform/backup-vault/r2-vault';

// The first real production restore succeeded and was then reported FAILED,
// because the check demanded attendance_punch_evidence — a table belonging to
// a migration production has deliberately not received. The backup was fine;
// the expectation was wrong.
//
// A restore test validates the database that was backed up, not the one the
// application currently wants. Those differ whenever a migration is pending,
// which is exactly when a restore test matters most.

const PUNCH_MIGRATION = '20260820000300_attendance_punch_evidence';
const PHOTO_MIGRATION = '20260820000500_attendance_punch_photo';
const COMPOFF_MIGRATION = '20260821010000_management_attendance_policy_extension';

const MIGRATION_TABLES = {
  [PUNCH_MIGRATION]: ['attendance_punch_evidence'],
  [PHOTO_MIGRATION]: ['attendance_punch_photos'],
  [COMPOFF_MIGRATION]: ['comp_off_credits'],
};

/** What production actually had at backup time: no Attendance migrations. */
const PRODUCTION_MIGRATIONS = [
  '20260101000000_init',
  '20260601000000_hrms_foundation',
];

describe('expectations come from the restored migration history', () => {
  it('requires only baseline tables for a pre-Attendance backup', () => {
    const plan = planSchemaExpectations(PRODUCTION_MIGRATIONS, MIGRATION_TABLES);
    const required = plan.filter((e) => e.requirement !== 'NOT_APPLICABLE');

    expect(required.map((e) => e.table).sort()).toEqual([...BASELINE_TABLES].sort());
  });

  it('marks unapplied migrations NOT_APPLICABLE rather than missing', () => {
    const plan = planSchemaExpectations(PRODUCTION_MIGRATIONS, MIGRATION_TABLES);
    const punch = plan.find((e) => e.table === 'attendance_punch_evidence')!;

    expect(punch.requirement).toBe('NOT_APPLICABLE');
    expect(punch.migration).toBe(PUNCH_MIGRATION);
    expect(punch.reason).toMatch(/had not run when this backup was taken/);
  });

  it('requires a table once its migration is recorded as applied', () => {
    const plan = planSchemaExpectations(
      [...PRODUCTION_MIGRATIONS, PUNCH_MIGRATION],
      MIGRATION_TABLES,
    );
    const punch = plan.find((e) => e.table === 'attendance_punch_evidence')!;

    expect(punch.requirement).toBe('REQUIRED_BY_MIGRATION');
    expect(punch.reason).toMatch(/records as applied/);
  });

  it('reads the real migration directory rather than a hand-kept list', () => {
    // The hand-kept version was already wrong: it demanded a table called
    // attendance_punch_photo_assets, which has never existed.
    const map = readMigrationTableMap(resolve(__dirname, '../../prisma/migrations'));

    expect(map[PUNCH_MIGRATION]).toContain('attendance_punch_evidence');
    expect(map[PHOTO_MIGRATION]).toContain('attendance_punch_photos');
    expect(map[COMPOFF_MIGRATION]).toContain('comp_off_credits');
    expect(JSON.stringify(map)).not.toContain('attendance_punch_photo_assets');
  });

  it('returns an empty map rather than throwing on a missing directory', () => {
    expect(readMigrationTableMap('/no/such/place')).toEqual({});
  });
});

describe('verifying a restored schema', () => {
  const present = (extra: string[] = []) => new Set([...BASELINE_TABLES, ...extra]);

  it('passes a pre-Attendance production restore', () => {
    const plan = planSchemaExpectations(PRODUCTION_MIGRATIONS, MIGRATION_TABLES);
    const verdict = verifySchema(plan, present());

    expect(verdict.passed).toBe(true);
    expect(verdict.missing).toEqual([]);
    expect(verdict.notApplicable).toBe(3);
  });

  it('fails when an applied migration claims a table that is absent', () => {
    // The migration says it created the table. If it is not there, the restore
    // did not carry what the history claims.
    const plan = planSchemaExpectations(
      [...PRODUCTION_MIGRATIONS, PUNCH_MIGRATION],
      MIGRATION_TABLES,
    );
    const verdict = verifySchema(plan, present());

    expect(verdict.passed).toBe(false);
    expect(verdict.missing.map((m) => m.table)).toEqual(['attendance_punch_evidence']);
  });

  it('passes once the applied migration table is actually present', () => {
    const plan = planSchemaExpectations(
      [...PRODUCTION_MIGRATIONS, PUNCH_MIGRATION],
      MIGRATION_TABLES,
    );

    expect(verifySchema(plan, present(['attendance_punch_evidence'])).passed).toBe(true);
  });

  it('fails on a missing baseline table whatever the migrations say', () => {
    const plan = planSchemaExpectations(PRODUCTION_MIGRATIONS, MIGRATION_TABLES);
    const withoutUsers = new Set([...BASELINE_TABLES].filter((t) => t !== 'users'));

    expect(verifySchema(plan, withoutUsers).passed).toBe(false);
  });

  it('does not look for NOT_APPLICABLE tables at all', () => {
    // Their absence is correct, and reporting it would bury real findings.
    const plan = planSchemaExpectations(PRODUCTION_MIGRATIONS, MIGRATION_TABLES);
    const verdict = verifySchema(plan, present());

    expect(verdict.missing).toHaveLength(0);
    expect(verdict.baselineChecked).toBe(BASELINE_TABLES.length);
    expect(verdict.migrationRequiredChecked).toBe(0);
  });
});

describe('the restore test end to end', () => {
  const env = {
    APP_ENV: 'test',
    RESTORE_TARGET_DATABASE_URL: 'postgresql://u:p@localhost:5432/apex_restore_test',
  };

  const vault: Vault = {
    async getToFile(_key, dest) {
      writeFileSync(dest, Buffer.alloc(2_000_000, 3));
    },
    async put() {},
    async head() {
      return null;
    },
    async list() {
      return [];
    },
    async remove() {},
  };

  const deps = (over: Partial<RestoreDeps> = {}): RestoreDeps => ({
    vault,
    restore: async () => {},
    countRows: async () => 41,
    listTables: async () => [...BASELINE_TABLES],
    listAppliedMigrations: async () => PRODUCTION_MIGRATIONS,
    migrationTables: () => MIGRATION_TABLES,
    now: () => new Date(),
    ...over,
  });

  it('CASE A: a pre-Attendance production backup PASSES', async () => {
    const report = await runRestoreTest(env, 'database/daily/prod.dump', null, deps());

    expect(report.restored).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.schema!.notApplicable).toBe(3);
    // Counted the baseline, never demanded the future.
    expect(report.checks.map((c) => c.table)).not.toContain('attendance_punch_evidence');
  });

  it('CASE B: a post-Attendance backup missing one of its tables FAILS', async () => {
    const report = await runRestoreTest(
      env,
      'database/daily/prod.dump',
      null,
      deps({
        listAppliedMigrations: async () => [...PRODUCTION_MIGRATIONS, PUNCH_MIGRATION],
        listTables: async () => [...BASELINE_TABLES], // punch table absent
      }),
    );

    expect(report.passed).toBe(false);
    expect(report.failureReason).toMatch(/attendance_punch_evidence/);
    expect(report.failureReason).toMatch(/migration history requires/);
  });

  it('passes a post-Attendance backup that has its tables', async () => {
    const report = await runRestoreTest(
      env,
      'database/daily/prod.dump',
      null,
      deps({
        listAppliedMigrations: async () => [...PRODUCTION_MIGRATIONS, PUNCH_MIGRATION],
        listTables: async () => [...BASELINE_TABLES, 'attendance_punch_evidence'],
      }),
    );

    expect(report.passed).toBe(true);
    expect(report.checks.map((c) => c.table)).toContain('attendance_punch_evidence');
  });

  it('reads migrations from the restored database, not the working tree', async () => {
    const listAppliedMigrations = jest.fn(async () => PRODUCTION_MIGRATIONS);
    await runRestoreTest(env, 'k', null, deps({ listAppliedMigrations }));

    expect(listAppliedMigrations).toHaveBeenCalledWith(env.RESTORE_TARGET_DATABASE_URL);
  });

  it('still fails a restore with no migration history at all', async () => {
    const report = await runRestoreTest(
      env,
      'k',
      null,
      deps({ listAppliedMigrations: async () => [] }),
    );

    expect(report.passed).toBe(false);
    expect(report.failureReason).toMatch(/no Prisma migration history/);
  });

  it('fails when a required table exists but cannot be read', async () => {
    const report = await runRestoreTest(
      env,
      'k',
      null,
      deps({
        countRows: async (_u, table) => {
          if (table === 'users') throw new Error('permission denied');
          return 1;
        },
      }),
    );

    expect(report.passed).toBe(false);
    expect(report.failureReason).toMatch(/could not be read/);
  });

  it('never runs a migration as part of the test', () => {
    // Migrating would change the restored schema and stop it being a recovery
    // test of the backup.
    const src = require('fs').readFileSync(
      resolve(__dirname, '../../scripts/backup/run-restore-test.ts'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/migrate\s+(deploy|dev)/);
    expect(code).not.toMatch(/db\s+push/);
  });
});
