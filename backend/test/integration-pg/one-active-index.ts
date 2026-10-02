/**
 * The current one-active-timer guardrail: since Phase 4 the index covering
 * active ASSIGNEE and REVIEWER rows (it replaced the Phase 2D1 ASSIGNEE-only
 * index). For suites that must reproduce a database from BEFORE the guardrail
 * (duplicate active timers), and for the suites that prove the migrations.
 *
 * `applyOneActiveMigration` runs the real migration.sql, not a copy of it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { assertServerIdentity } from './db-guard';

export const ONE_ACTIVE_INDEX = 'ticket_time_logs_one_active_timed_per_user';
/** The Phase 2D1 ASSIGNEE-only index the Phase 4 migration replaces. */
export const LEGACY_ONE_ACTIVE_INDEX = 'ticket_time_logs_one_active_assignee_per_user';

const MIGRATION = path.resolve(
  __dirname,
  '../../prisma/migrations/20261002000000_one_active_timed_ticket_per_user/migration.sql',
);

type Db = {
  $executeRawUnsafe(q: string): Promise<unknown>;
  $queryRawUnsafe<T = unknown>(q: string): Promise<T>;
};

/** The migration's statements: the duplicate precheck (DO block), then each following statement. */
export function oneActiveMigrationStatements(): string[] {
  const sql = fs
    .readFileSync(MIGRATION, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const end = sql.indexOf('END $$;');
  if (end < 0) throw new Error('migration.sql no longer has the expected DO block');
  const rest = sql
    .slice(end + 'END $$;'.length)
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [sql.slice(0, end + 'END $$;'.length).trim(), ...rest];
}

export async function applyOneActiveMigration(db: Db) {
  await assertServerIdentity(db as any);
  for (const statement of oneActiveMigrationStatements()) await db.$executeRawUnsafe(statement);
}

export async function dropOneActiveIndex(db: Db) {
  await assertServerIdentity(db as any);
  await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${ONE_ACTIVE_INDEX}"`);
  await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${LEGACY_ONE_ACTIVE_INDEX}"`);
}

export async function oneActiveIndexState(db: Db): Promise<{ exists: boolean; valid: boolean; definition: string | null }> {
  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS def
     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = '${ONE_ACTIVE_INDEX}'`,
  );
  return rows.length
    ? { exists: true, valid: Boolean(rows[0].valid), definition: String(rows[0].def) }
    : { exists: false, valid: false, definition: null };
}

/**
 * Leaves the integration database with the guardrail in place, as `prisma
 * migrate deploy` created it. Call only once duplicates are gone.
 */
export async function restoreOneActiveIndex(db: Db) {
  if (!(await oneActiveIndexState(db)).exists) await applyOneActiveMigration(db);
}
