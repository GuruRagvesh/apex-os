/**
 * Staging migration helper — identity gate and command allow-list. Pure; no database.
 */
import * as fs from 'fs';
import * as path from 'path';
import { checkStagingIdentity, pendingMigrations, EXPECTED_MIGRATIONS } from '../../scripts/staging-recovery-migrate';

const STAGING = 'postgresql://u:p@dpg-d95pamvaqgkc73fdurig-a.oregon-postgres.render.com/apex_os_staging';

describe('staging migration helper', () => {
  it('accepts only the verified staging database with APP_ENV=staging, and reports host/name only', () => {
    expect(checkStagingIdentity(STAGING, 'staging')).toEqual({ ok: true, host: 'dpg-d95pamvaqgkc73fdurig-a.oregon-postgres.render.com', database: 'apex_os_staging' });
    expect(checkStagingIdentity(STAGING.replace('apex_os_staging', 'apex_os_staging_x1y2'), 'staging').ok).toBe(true);
    expect(JSON.stringify(checkStagingIdentity(STAGING, 'staging'))).not.toMatch(/u:p@|"p"/);
  });

  it.each([
    ['APP_ENV unset', STAGING, undefined],
    ['APP_ENV production', STAGING, 'production'],
    ['current production DB', 'postgresql://u:p@dpg-db2v0som7kps73ceebd0-a.oregon-postgres.render.com/apex_db_dugl_ngz6', 'staging'],
    ['earlier production DB', 'postgresql://u:p@dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com/apex_db_dugl', 'staging'],
    ['staging host with a production db name', 'postgresql://u:p@dpg-d95pamvaqgkc73fdurig-a.oregon-postgres.render.com/apex_db_dugl_ngz6', 'staging'],
    ['unknown Render database', 'postgresql://u:p@dpg-zzzzzzzzzzzzzzzzzzzz-a.oregon-postgres.render.com/apex_os_staging', 'staging'],
    ['internal Render URL', 'postgresql://u:p@dpg-d95pamvaqgkc73fdurig-a/apex_os_staging', 'staging'],
    ['look-alike host', 'postgresql://u:p@dpg-d95pamvaqgkc73fdurig-a.oregon-postgres.render.com.evil.example/apex_os_staging', 'staging'],
    ['wrong db name', 'postgresql://u:p@dpg-d95pamvaqgkc73fdurig-a.oregon-postgres.render.com/postgres', 'staging'],
    ['localhost', 'postgresql://u:p@localhost:5432/apex_os_staging', 'staging'],
    ['not set', undefined, 'staging'],
  ])('refuses: %s', (_label, url, appEnv) => {
    expect(checkStagingIdentity(url as any, appEnv as any).ok).toBe(false);
  });

  it('reads pending migrations from `prisma migrate status` output', () => {
    const out = '54 migrations found in prisma/migrations\nFollowing migrations have not yet been applied:\n20261009000000_attendance_recovery_foundation\n20261010000000_attendance_recovery_import_mode\n\nTo apply migrations…';
    expect(pendingMigrations(out)).toEqual(EXPECTED_MIGRATIONS);
    expect(pendingMigrations('Database schema is up to date!')).toEqual([]);
  });

  it('can only ever run `migrate status` and `migrate deploy` — never dev, db push, reset or a seed', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/staging-recovery-migrate.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).toMatch(/const ALLOWED: ReadonlyArray<ReadonlyArray<string>> = \[\['migrate', 'status'\], \['migrate', 'deploy'\]\];/);
    expect(code).not.toMatch(/'dev'|'push'|'reset'|seed|\$executeRaw|\$queryRaw|PrismaClient/);
  });
});
