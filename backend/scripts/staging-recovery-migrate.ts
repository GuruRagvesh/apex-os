/**
 * Staging-only migration helper for the attendance-recovery branch.
 *
 *   APP_ENV=staging STAGING_DATABASE_URL=<external staging URL> \
 *     npx ts-node --transpile-only scripts/staging-recovery-migrate.ts
 *
 * Runs EXACTLY:  prisma migrate status → prisma migrate deploy → prisma migrate status
 * and nothing else. It never runs `migrate dev`, `db push`, `migrate reset`, a
 * seed, or any SQL of its own.
 *
 * Identity — verified 2026-10-09 from the DATABASE_URL attached to each Render
 * BACKEND service (the runtime target is authoritative over resource names,
 * old docs and older repo markers):
 *
 *   ACTIVE STAGING   dpg-db2v0som7kps73ceebd0  /  apex_db_dugl_ngz6   → accepted
 *   PRODUCTION       dpg-d8259omk1jcs73e37fbg  /  apex_db_dugl        → refused
 *   LEGACY STAGING   dpg-d95pamvaqgkc73fdurig  /  apex_os_staging_db  → refused
 *
 * Matching is EXACT: the host's first DNS label must be the host id (Render
 * adds "-a"), and the database name must be equal, not similar. No substring
 * matching — the active staging name contains the production name.
 *
 * Refuses before any database contact unless APP_ENV is exactly "staging" in
 * the shell running it (a deliberate act) and the URL is the EXTERNAL Render
 * URL of the active staging database. Production and legacy staging are
 * recognised and refused by name; every other database — any unknown Render
 * database, localhost, an internal URL — is refused.
 *
 * And refuses to DEPLOY unless the pending migrations are exactly a subset of
 * the two additive recovery migrations this branch introduces. Anything else
 * pending means staging is not where this branch expects it to be; stop and look.
 *
 * Prints only host, database name and APP_ENV. Never the URL, user or password.
 */
import { spawnSync } from 'child_process';
import * as readline from 'readline';

export const ACTIVE_STAGING = { hostId: 'dpg-db2v0som7kps73ceebd0', database: 'apex_db_dugl_ngz6' } as const;
export const PRODUCTION = { hostId: 'dpg-d8259omk1jcs73e37fbg', database: 'apex_db_dugl' } as const;
export const LEGACY_STAGING = { hostId: 'dpg-d95pamvaqgkc73fdurig', database: 'apex_os_staging_db' } as const;
export const EXPECTED_MIGRATIONS = [
  '20261009000000_attendance_recovery_foundation',
  '20261010000000_attendance_recovery_import_mode',
];
export const CONFIRM_PHRASE = 'APPLY STAGING RECOVERY MIGRATIONS';

export type StagingRefusal =
  | 'APP_ENV_NOT_STAGING'
  | 'URL_NOT_SET'
  | 'URL_MALFORMED'
  | 'NOT_POSTGRESQL'
  | 'PRODUCTION_DATABASE'
  | 'LEGACY_STAGING_NOT_ACTIVE'
  | 'INTERNAL_URL'
  | 'NOT_RENDER_HOST'
  | 'UNKNOWN_DATABASE_HOST'
  | 'WRONG_DATABASE_NAME';

export interface StagingIdentity {
  ok: boolean;
  host?: string;
  database?: string;
  code?: StagingRefusal;
  reason?: string;
}

/** Render hostnames are "<hostId>-a" (internal) or "<hostId>-a.<region>-postgres.render.com" (external). */
const isHost = (firstLabel: string, hostId: string) => firstLabel === hostId || firstLabel === `${hostId}-a`;

/** Pure: decides whether a URL + APP_ENV is the active staging database. No I/O. */
export function checkStagingIdentity(rawUrl: string | undefined, appEnv: string | undefined): StagingIdentity {
  const refuse = (code: StagingRefusal, reason: string, host?: string, database?: string): StagingIdentity =>
    ({ ok: false, ...(host !== undefined ? { host } : {}), ...(database !== undefined ? { database } : {}), code, reason });

  if ((appEnv ?? '').trim() !== 'staging') return refuse('APP_ENV_NOT_STAGING', 'APP_ENV must be exactly "staging"');
  if (!rawUrl) return refuse('URL_NOT_SET', 'STAGING_DATABASE_URL is not set');
  let u: URL;
  try { u = new URL(rawUrl); } catch { return refuse('URL_MALFORMED', 'STAGING_DATABASE_URL is not a valid URL'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return refuse('NOT_POSTGRESQL', 'not a PostgreSQL URL');

  const host = u.hostname.toLowerCase();
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const firstLabel = host.split('.')[0];

  // Known databases first, by exact host id OR exact name, so a mixed-up URL
  // (staging host + production name, or the reverse) is still caught.
  if (isHost(firstLabel, PRODUCTION.hostId) || database === PRODUCTION.database) {
    return refuse('PRODUCTION_DATABASE', 'this is the PRODUCTION database', host, database);
  }
  if (isHost(firstLabel, LEGACY_STAGING.hostId) || database === LEGACY_STAGING.database) {
    return refuse('LEGACY_STAGING_NOT_ACTIVE', 'this is the LEGACY staging database, which is no longer the active staging target', host, database);
  }
  if (!host.includes('.')) return refuse('INTERNAL_URL', 'internal Render URL; use the EXTERNAL staging URL', host, database);
  if (!/^[a-z0-9-]+\.[a-z0-9-]+\.render\.com$/.test(host)) return refuse('NOT_RENDER_HOST', 'not a Render database hostname', host, database);
  if (!isHost(firstLabel, ACTIVE_STAGING.hostId)) return refuse('UNKNOWN_DATABASE_HOST', 'host is not the active staging database', host, database);
  if (database !== ACTIVE_STAGING.database) return refuse('WRONG_DATABASE_NAME', 'database name is not the active staging database', host, database);
  return { ok: true, host, database };
}

/** Migration names listed as pending in `prisma migrate status` output. */
export function pendingMigrations(statusOutput: string): string[] {
  const at = statusOutput.indexOf('have not yet been applied');
  if (at < 0) return [];
  return [...statusOutput.slice(at).matchAll(/^(\d{14}_[a-z0-9_]+)\s*$/gim)].map((m) => m[1]);
}

/** The only Prisma commands this helper may run. */
const ALLOWED: ReadonlyArray<ReadonlyArray<string>> = [['migrate', 'status'], ['migrate', 'deploy']];

function prisma(args: string[], url: string, secrets: string[]): { code: number; out: string } {
  if (!ALLOWED.some((a) => a.length === args.length && a.every((x, i) => x === args[i]))) throw new Error('refused: command not allowed');
  const r = spawnSync('npx', ['prisma', ...args], {
    cwd: __dirname + '/..',
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  let out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('***');
  return { code: r.status ?? 1, out };
}

async function main() {
  const raw = process.env.STAGING_DATABASE_URL;
  const id = checkStagingIdentity(raw, process.env.APP_ENV);
  console.log('Attendance recovery — staging migration helper\n');
  if (id.host) console.log(`DB host:  ${id.host}`);
  if (id.database) console.log(`DB name:  ${id.database}`);
  console.log(`APP_ENV:  ${process.env.APP_ENV ?? '(unset)'}`);
  if (!id.ok) {
    console.error(`\nREFUSED (${id.code}): ${id.reason}. Nothing was run.`);
    process.exit(1);
  }
  const u = new URL(raw!);
  const secrets = [raw!, u.password, decodeURIComponent(u.password), u.username];

  console.log('\n[1/3] prisma migrate status');
  const before = prisma(['migrate', 'status'], raw!, secrets);
  console.log(before.out.split('\n').filter((l) => /migration|applied|up to date|\d{14}_/i.test(l)).join('\n'));
  const pending = pendingMigrations(before.out);
  if (pending.length === 0) {
    console.log('\nNothing pending. The recovery migrations are already applied; nothing to deploy.');
    return;
  }
  const unexpected = pending.filter((m) => !EXPECTED_MIGRATIONS.includes(m));
  if (unexpected.length) {
    console.error(`\nREFUSED: unexpected pending migrations: ${unexpected.join(', ')}. Staging is not where this branch expects; nothing was deployed.`);
    process.exit(1);
  }

  const answer = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\nPending: ${pending.join(', ')}\nType exactly "${CONFIRM_PHRASE}" to apply them to STAGING: `, (a) => { rl.close(); resolve(a.trim()); });
  });
  if (answer !== CONFIRM_PHRASE) {
    console.error('\nNot confirmed. Nothing was deployed.');
    process.exit(1);
  }

  console.log('\n[2/3] prisma migrate deploy');
  const deploy = prisma(['migrate', 'deploy'], raw!, secrets);
  console.log(deploy.out.split('\n').filter((l) => /migration|applied|\d{14}_|error/i.test(l)).join('\n'));
  if (deploy.code !== 0) {
    console.error('\nmigrate deploy FAILED. Check the output above; do not retry blindly.');
    process.exit(1);
  }

  console.log('\n[3/3] prisma migrate status');
  const after = prisma(['migrate', 'status'], raw!, secrets);
  console.log(after.out.split('\n').filter((l) => /migration|applied|up to date|\d{14}_/i.test(l)).join('\n'));
  if (pendingMigrations(after.out).length) {
    console.error('\nMigrations are still pending after deploy.');
    process.exit(1);
  }
  console.log('\nDone. Staging schema is up to date.');
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Helper failed:', e?.message ?? e);
    process.exit(1);
  });
}
