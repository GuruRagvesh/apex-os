import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * What schema a restored backup is allowed to have.
 *
 * A restore test validates the database that was backed up, not the one the
 * application currently wants. Those differ whenever a migration is pending —
 * which is exactly the situation before a release, and exactly when a restore
 * test matters most.
 *
 * The first real production restore succeeded and was then reported as FAILED
 * because the check demanded attendance_punch_evidence, a table belonging to a
 * migration production has deliberately not received. The backup was fine; the
 * expectation was wrong.
 *
 * So expectations are derived from the restored _prisma_migrations history:
 *
 *   migration recorded  →  its tables are REQUIRED, and missing one is a real
 *                          failure, because the migration claims to have
 *                          created it
 *   migration absent    →  its tables are NOT_APPLICABLE, not failures
 *
 * Derived from the migration SQL rather than a hand-kept list, so a migration
 * added later is covered without anybody remembering to update this. The
 * hand-kept version was already wrong: it demanded a table named
 * attendance_punch_photo_assets, which has never existed.
 */

/**
 * Tables expected in every Apex OS database, whatever migrations have run.
 *
 * These predate the Attendance release. If one is missing from a restore, the
 * dump did not carry the business.
 */
export const BASELINE_TABLES = [
  '_prisma_migrations',
  'users',
  'work_sessions',
  'break_logs',
  'daily_attendance',
  'attendance_regularizations',
  'leave_requests',
  'attendance_policies',
  'holiday_calendars',
  'app_settings',
] as const;

export type MigrationTableMap = Record<string, string[]>;

/**
 * Reads which tables each migration creates.
 *
 * Only CREATE TABLE is parsed: a migration that merely alters an existing
 * table adds no new existence requirement.
 */
export function readMigrationTableMap(migrationsDir: string): MigrationTableMap {
  const map: MigrationTableMap = {};

  let entries: string[];
  try {
    entries = readdirSync(migrationsDir);
  } catch {
    return map;
  }

  for (const name of entries) {
    let sql: string;
    try {
      sql = readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
    } catch {
      continue; // not a migration directory
    }
    const tables = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/gi)].map(
      (m) => m[1],
    );
    if (tables.length > 0) map[name] = [...new Set(tables)];
  }
  return map;
}

export type Requirement = 'BASELINE' | 'REQUIRED_BY_MIGRATION' | 'NOT_APPLICABLE';

export interface TableExpectation {
  table: string;
  requirement: Requirement;
  /** Which migration introduced it, when it is not a baseline table. */
  migration: string | null;
  reason: string;
}

/**
 * Decides what the restored database must contain.
 *
 * `appliedMigrations` comes from the RESTORED database's own
 * _prisma_migrations, never from the working tree: the question is what that
 * backup claimed to be, not what the repository has since become.
 */
export function planSchemaExpectations(
  appliedMigrations: string[],
  migrationTables: MigrationTableMap,
): TableExpectation[] {
  const applied = new Set(appliedMigrations);
  const out: TableExpectation[] = BASELINE_TABLES.map((table) => ({
    table,
    requirement: 'BASELINE' as const,
    migration: null,
    reason: 'Present in every Apex OS database',
  }));

  const seen = new Set<string>(BASELINE_TABLES);

  for (const [migration, tables] of Object.entries(migrationTables).sort()) {
    const isApplied = applied.has(migration);
    for (const table of tables) {
      if (seen.has(table)) continue;
      seen.add(table);
      out.push({
        table,
        requirement: isApplied ? 'REQUIRED_BY_MIGRATION' : 'NOT_APPLICABLE',
        migration,
        reason: isApplied
          ? `Created by ${migration}, which this backup records as applied`
          : `Created by ${migration}, which had not run when this backup was taken`,
      });
    }
  }
  return out;
}

export interface SchemaVerdict {
  baselineChecked: number;
  migrationRequiredChecked: number;
  notApplicable: number;
  missing: TableExpectation[];
  passed: boolean;
}

/**
 * Compares expectations against what the restore actually produced.
 *
 * NOT_APPLICABLE tables are not looked for at all — their absence is the
 * correct state, and reporting it as a finding would bury real ones.
 */
export function verifySchema(
  expectations: TableExpectation[],
  presentTables: ReadonlySet<string>,
): SchemaVerdict {
  const required = expectations.filter((e) => e.requirement !== 'NOT_APPLICABLE');
  const missing = required.filter((e) => !presentTables.has(e.table));

  return {
    baselineChecked: expectations.filter((e) => e.requirement === 'BASELINE').length,
    migrationRequiredChecked: expectations.filter(
      (e) => e.requirement === 'REQUIRED_BY_MIGRATION',
    ).length,
    notApplicable: expectations.filter((e) => e.requirement === 'NOT_APPLICABLE').length,
    missing,
    passed: missing.length === 0,
  };
}
