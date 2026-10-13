/**
 * Staging migration helper — identity gate and command allow-list. Pure; no database.
 *
 * Identity verified 2026-10-09 from each Render backend's DATABASE_URL:
 *   active staging  dpg-db2v0som7kps73ceebd0 / apex_db_dugl_ngz6   accepted
 *   production      dpg-d8259omk1jcs73e37fbg / apex_db_dugl        refused
 *   legacy staging  dpg-d95pamvaqgkc73fdurig / apex_os_staging_db  refused
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { checkStagingIdentity, pendingMigrations, EXPECTED_MIGRATIONS } from '../../scripts/staging-recovery-migrate';

const url = (host: string, db: string) => `postgresql://someuser:somepassword@${host}/${db}`;
const STAGING_HOST = 'dpg-db2v0som7kps73ceebd0-a.oregon-postgres.render.com';
const PROD_HOST = 'dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com';
const LEGACY_HOST = 'dpg-d95pamvaqgkc73fdurig-a.oregon-postgres.render.com';
const STAGING = url(STAGING_HOST, 'apex_db_dugl_ngz6');

describe('staging migration helper — identity', () => {
  it('1. accepts the active staging external URL with APP_ENV=staging, reporting host and name only', () => {
    expect(checkStagingIdentity(STAGING, 'staging')).toEqual({ ok: true, host: STAGING_HOST, database: 'apex_db_dugl_ngz6' });
    expect(checkStagingIdentity(`${STAGING}?sslmode=require`, 'staging').ok).toBe(true);
    expect(checkStagingIdentity(url(`${STAGING_HOST}:5432`, 'apex_db_dugl_ngz6'), 'staging').ok).toBe(true);
  });

  it.each([
    ['2. active staging internal hostname', url('dpg-db2v0som7kps73ceebd0-a', 'apex_db_dugl_ngz6'), 'staging', 'INTERNAL_URL'],
    ['3. current production host + db', url(PROD_HOST, 'apex_db_dugl'), 'staging', 'PRODUCTION_DATABASE'],
    ['3b. current production internal URL', url('dpg-d8259omk1jcs73e37fbg-a', 'apex_db_dugl'), 'staging', 'PRODUCTION_DATABASE'],
    ['4. legacy staging host + db', url(LEGACY_HOST, 'apex_os_staging_db'), 'staging', 'LEGACY_STAGING_NOT_ACTIVE'],
    ['4b. legacy staging internal URL', url('dpg-d95pamvaqgkc73fdurig-a', 'apex_os_staging_db'), 'staging', 'LEGACY_STAGING_NOT_ACTIVE'],
    ['5. active staging host + production db name', url(STAGING_HOST, 'apex_db_dugl'), 'staging', 'PRODUCTION_DATABASE'],
    ['6. production host + staging db name', url(PROD_HOST, 'apex_db_dugl_ngz6'), 'staging', 'PRODUCTION_DATABASE'],
    ['6b. legacy host + staging db name', url(LEGACY_HOST, 'apex_db_dugl_ngz6'), 'staging', 'LEGACY_STAGING_NOT_ACTIVE'],
    ['6c. staging db name on an unknown host', url('dpg-zzzzzzzzzzzzzzzzzzzz-a.oregon-postgres.render.com', 'apex_db_dugl_ngz6'), 'staging', 'UNKNOWN_DATABASE_HOST'],
    ['6d. active staging host + legacy db name', url(STAGING_HOST, 'apex_os_staging_db'), 'staging', 'LEGACY_STAGING_NOT_ACTIVE'],
    ['6e. active staging host + another db name', url(STAGING_HOST, 'apex_db_dugl_ngz6x'), 'staging', 'WRONG_DATABASE_NAME'],
    ['6f. active staging host + a broad apex_db_* name', url(STAGING_HOST, 'apex_db_other'), 'staging', 'WRONG_DATABASE_NAME'],
    ['7. unknown Render host', url('dpg-abcabcabcabcabcabcab-a.frankfurt-postgres.render.com', 'some_db'), 'staging', 'UNKNOWN_DATABASE_HOST'],
    ['7b. look-alike host (suffix appended)', url(`${STAGING_HOST}.evil.example`, 'apex_db_dugl_ngz6'), 'staging', 'NOT_RENDER_HOST'],
    ['7c. look-alike host (prefix added)', url(`x${STAGING_HOST}`, 'apex_db_dugl_ngz6'), 'staging', 'UNKNOWN_DATABASE_HOST'],
    ['8. localhost', url('localhost:5432', 'apex_db_dugl_ngz6'), 'staging', 'INTERNAL_URL'],
    ['9. APP_ENV unset', STAGING, undefined, 'APP_ENV_NOT_STAGING'],
    ['10. APP_ENV=production', STAGING, 'production', 'APP_ENV_NOT_STAGING'],
    ['10b. APP_ENV=Staging (not exact)', STAGING, 'Staging', 'APP_ENV_NOT_STAGING'],
    ['11. malformed URL', 'not a url', 'staging', 'URL_MALFORMED'],
    ['11b. URL not set', undefined, 'staging', 'URL_NOT_SET'],
    ['12. non-PostgreSQL URL', `mysql://someuser:somepassword@${STAGING_HOST}/apex_db_dugl_ngz6`, 'staging', 'NOT_POSTGRESQL'],
  ])('refuses %s → %s', (_label, raw, appEnv, code) => {
    const r = checkStagingIdentity(raw as any, appEnv as any);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(code);
  });

  it('never returns the username, password or full URL', () => {
    for (const raw of [STAGING, url(PROD_HOST, 'apex_db_dugl'), url(LEGACY_HOST, 'apex_os_staging_db')]) {
      const out = JSON.stringify(checkStagingIdentity(raw, 'staging'));
      expect(out).not.toMatch(/someuser|somepassword|postgresql:\/\//);
    }
  });
});

describe('staging migration helper — CLI refuses before any database contact', () => {
  // Runs the real script. A refused identity exits before Prisma is ever spawned,
  // so no database — and certainly not production — can be contacted.
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', path.join(__dirname, '../../scripts/staging-recovery-migrate.ts')], {
      cwd: path.join(__dirname, '../..'),
      env: { ...process.env, ...env, TS_NODE_TRANSPILE_ONLY: 'true', DATABASE_URL: '' },
      encoding: 'utf8',
      timeout: 60_000,
    });

  it.each([
    ['production', url(PROD_HOST, 'apex_db_dugl'), 'PRODUCTION_DATABASE'],
    ['legacy staging', url(LEGACY_HOST, 'apex_os_staging_db'), 'LEGACY_STAGING_NOT_ACTIVE'],
    ['unknown database', url('dpg-abcabcabcabcabcabcab-a.oregon-postgres.render.com', 'x'), 'UNKNOWN_DATABASE_HOST'],
  ])('%s: refused, prints only host / name / APP_ENV, never credentials, never runs Prisma', (_label, raw, code) => {
    const r = run({ APP_ENV: 'staging', STAGING_DATABASE_URL: raw });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status).toBe(1);
    expect(out).toContain(`REFUSED (${code})`);
    expect(out).toContain('Nothing was run.');
    expect(out).not.toMatch(/someuser|somepassword|postgresql:\/\//);
    expect(out).not.toMatch(/\[1\/3\]|prisma migrate|Datasource/i);
  });
});

describe('staging migration helper — migrations and commands', () => {
  it('reads pending migrations from `prisma migrate status` output; only the two recovery migrations are expected', () => {
    expect(EXPECTED_MIGRATIONS).toEqual(['20261009000000_attendance_recovery_foundation', '20261010000000_attendance_recovery_import_mode']);
    const out = '54 migrations found in prisma/migrations\nFollowing migrations have not yet been applied:\n20261009000000_attendance_recovery_foundation\n20261010000000_attendance_recovery_import_mode\n\nTo apply migrations…';
    expect(pendingMigrations(out)).toEqual(EXPECTED_MIGRATIONS);
    expect(pendingMigrations('Database schema is up to date!')).toEqual([]);
  });

  it('can only ever run `migrate status` and `migrate deploy` — never dev, db push, reset, a seed or raw SQL', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/staging-recovery-migrate.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).toMatch(/const ALLOWED: ReadonlyArray<ReadonlyArray<string>> = \[\['migrate', 'status'\], \['migrate', 'deploy'\]\];/);
    expect(code).not.toMatch(/'dev'|'push'|'reset'|seed|\$executeRaw|\$queryRaw|PrismaClient/);
  });

  it('uses exact matching only — no substring regex that would confuse apex_db_dugl with apex_db_dugl_ngz6', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/staging-recovery-migrate.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/\/apex_db_dugl\/|PRODUCTION_MARKERS|STAGING_DB\s*=/);
  });
});

describe('staging migration helper — additional staging databases (exact allowlist)', () => {
  const NEW_DB = 'apex_db_dugl_ngz6_refresh_20261013';
  const NEW = url(STAGING_HOST, NEW_DB);

  it('A1. a refreshed staging database is accepted only when it is listed, exactly', () => {
    expect(checkStagingIdentity(NEW, 'staging', NEW_DB)).toEqual({ ok: true, host: STAGING_HOST, database: NEW_DB });
    expect(checkStagingIdentity(NEW, 'staging', ` other_db_name , ${NEW_DB} `).ok).toBe(true);
  });

  it('A2. the original active staging database stays accepted with or without a list', () => {
    expect(checkStagingIdentity(STAGING, 'staging', '').ok).toBe(true);
    expect(checkStagingIdentity(STAGING, 'staging', NEW_DB).ok).toBe(true);
  });

  it('A3. an unlisted name is refused: no pattern, prefix or "anything not production" rule', () => {
    expect(checkStagingIdentity(NEW, 'staging', '').code).toBe('WRONG_DATABASE_NAME');
    expect(checkStagingIdentity(NEW, 'staging', 'apex_db_dugl_ngz6_refresh').code).toBe('WRONG_DATABASE_NAME'); // prefix of it
    expect(checkStagingIdentity(url(STAGING_HOST, `${NEW_DB}2`), 'staging', NEW_DB).code).toBe('WRONG_DATABASE_NAME'); // longer than it
    expect(checkStagingIdentity(url(STAGING_HOST, 'apex_db_other'), 'staging', NEW_DB).code).toBe('WRONG_DATABASE_NAME');
  });

  it('A4. a missing list fails closed (only the original database is approved)', () => {
    const saved = process.env.STAGING_ALLOWED_DATABASE_NAMES;
    delete process.env.STAGING_ALLOWED_DATABASE_NAMES;
    try {
      expect(checkStagingIdentity(NEW, 'staging').code).toBe('WRONG_DATABASE_NAME');
      expect(checkStagingIdentity(STAGING, 'staging').ok).toBe(true);
    } finally { if (saved !== undefined) process.env.STAGING_ALLOWED_DATABASE_NAMES = saved; }
  });

  it.each([
    ['the production database', 'apex_db_dugl'],
    ['the legacy staging database', 'apex_os_staging_db'],
    ['a wildcard', 'apex_db_%'],
    ['a star', '*'],
    ['an upper-case or spaced name', 'Apex DB'],
    ['a name too short', 'ab'],
    ['a good name next to a bad one', `${NEW_DB},apex_db_dugl`],
  ])('A5. a list containing %s is rejected as a whole, and refuses even a listed database', (_label, list) => {
    const r = checkStagingIdentity(NEW, 'staging', list);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_STAGING_ALLOWLIST');
    expect(checkStagingIdentity(STAGING, 'staging', list).code).toBe('INVALID_STAGING_ALLOWLIST');
  });

  it('A6. production is refused FIRST, even if someone lists its name or host serves a listed name', () => {
    expect(checkStagingIdentity(url(PROD_HOST, NEW_DB), 'staging', NEW_DB).code).toBe('PRODUCTION_DATABASE');
    expect(checkStagingIdentity(url(PROD_HOST, 'apex_db_dugl'), 'staging', 'apex_db_dugl').code).toBe('PRODUCTION_DATABASE');
    expect(checkStagingIdentity(url(STAGING_HOST, 'apex_db_dugl'), 'staging', NEW_DB).code).toBe('PRODUCTION_DATABASE');
    expect(checkStagingIdentity(url(LEGACY_HOST, NEW_DB), 'staging', NEW_DB).code).toBe('LEGACY_STAGING_NOT_ACTIVE');
  });

  it('A7. a listed name does not move the host: another host and the internal URL are still refused', () => {
    expect(checkStagingIdentity(url('dpg-zzzzzzzzzzzzzzzzzzzz-a.oregon-postgres.render.com', NEW_DB), 'staging', NEW_DB).code).toBe('UNKNOWN_DATABASE_HOST');
    expect(checkStagingIdentity(url('dpg-db2v0som7kps73ceebd0-a', NEW_DB), 'staging', NEW_DB).code).toBe('INTERNAL_URL');
    expect(checkStagingIdentity(NEW, 'production', NEW_DB).code).toBe('APP_ENV_NOT_STAGING');
  });

  it('A8. the refusal output carries no credentials', () => {
    expect(JSON.stringify(checkStagingIdentity(NEW, 'staging', 'bad name'))).not.toMatch(/someuser|somepassword|postgresql:\/\//);
  });
});
