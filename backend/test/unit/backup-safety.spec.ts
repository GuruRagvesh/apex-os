import {
  assertNonProductionTarget,
  assertProductionTarget,
  mask,
  TargetRefused,
} from '../../scripts/backup/backup-identity';
import {
  applyRun,
  markFailed,
  objectKeyFor,
  startManifest,
  verifyAndComplete,
  type BackupState,
} from '../../scripts/backup/backup-manifest';
import {
  assertRetentionSane,
  classifyKey,
  planRetention,
} from '../../scripts/backup/backup-retention';
import { assessPhoto, summarise } from '../../scripts/backup/photo-reconciliation';

// These guard the company's ability to recover its HR records. The tests that
// matter are the refusals: a backup system that reports success wrongly is
// worse than none, because it removes the reason to look.

const PROD_HOST = 'dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com';
const PROD_DB = 'apex_db_dugl';

const prodEnv = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'production',
  DATABASE_URL: `postgresql://u:p@${PROD_HOST}:5432/${PROD_DB}`,
  EXPECTED_PRODUCTION_DB_HOST: PROD_HOST,
  EXPECTED_PRODUCTION_DB_NAME: PROD_DB,
  ...over,
});

describe('backup target identity', () => {
  it('accepts production when all three sources agree', () => {
    const id = assertProductionTarget(prodEnv());
    expect(id.host).toBe(PROD_HOST);
    expect(id.database).toBe(PROD_DB);
  });

  it('refuses when APP_ENV is not production', () => {
    expect(() => assertProductionTarget(prodEnv({ APP_ENV: 'staging' }))).toThrow(TargetRefused);
  });

  it('refuses when the expected values are not supplied', () => {
    expect(() =>
      assertProductionTarget(prodEnv({ EXPECTED_PRODUCTION_DB_HOST: '' })),
    ).toThrow(/must both be set/);
  });

  it('refuses a host mismatch even when everything else looks right', () => {
    expect(() =>
      assertProductionTarget(prodEnv({ EXPECTED_PRODUCTION_DB_HOST: 'other.render.com' })),
    ).toThrow(/Host mismatch/);
  });

  it('refuses a staging marker', () => {
    const stagingHost = 'dpg-d95pamvaqgkc73fdurig-a.oregon-postgres.render.com';
    expect(() =>
      assertProductionTarget(
        prodEnv({
          DATABASE_URL: `postgresql://u:p@${stagingHost}:5432/apex_os_staging_db`,
          EXPECTED_PRODUCTION_DB_HOST: stagingHost,
          EXPECTED_PRODUCTION_DB_NAME: 'apex_os_staging_db',
        }),
      ),
    ).toThrow(/non-production marker/);
  });

  it('never reveals the host or database in masked output', () => {
    expect(mask(PROD_HOST)).not.toContain('oregon');
    expect(mask(PROD_DB)).not.toBe(PROD_DB);
    expect(mask('')).toBe('(empty)');
  });
});

describe('restore target refuses production', () => {
  const testEnv = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    APP_ENV: 'test',
    RESTORE_TARGET_DATABASE_URL: 'postgresql://u:p@localhost:5432/apex_restore_test',
    ...over,
  });

  it('accepts an obviously disposable target', () => {
    expect(assertNonProductionTarget(testEnv()).database).toBe('apex_restore_test');
  });

  it('refuses when APP_ENV is production', () => {
    expect(() => assertNonProductionTarget(testEnv({ APP_ENV: 'production' }))).toThrow(
      /never target production/,
    );
  });

  it('refuses a known production host', () => {
    expect(() =>
      assertNonProductionTarget(
        testEnv({ RESTORE_TARGET_DATABASE_URL: `postgresql://u:p@${PROD_HOST}:5432/${PROD_DB}` }),
      ),
    ).toThrow(/production marker/);
  });

  it('refuses an unrecognised database rather than assuming it is safe', () => {
    // Silence is not consent: an unknown host could be production behind a
    // name this list has never seen.
    expect(() =>
      assertNonProductionTarget(
        testEnv({ RESTORE_TARGET_DATABASE_URL: 'postgresql://u:p@db.example.com:5432/apex_main' }),
      ),
    ).toThrow(/obviously disposable/);
  });
});

describe('a backup is not SUCCESS until the remote copy is verified', () => {
  const started = startManifest({
    backupId: 'b1',
    type: 'DAILY',
    environment: 'production',
    databaseName: mask(PROD_DB),
    startedAt: '2026-08-27T21:00:00.000Z',
  });
  const local = { objectKey: 'database/daily/2026/08/x.dump', byteSize: 5_000_000, sha256: 'a'.repeat(64) };
  const at = '2026-08-27T21:04:00.000Z';

  it('starts RUNNING, not SUCCESS', () => {
    expect(started.status).toBe('RUNNING');
    expect(started.remoteVerifiedAt).toBeNull();
  });

  it('succeeds only when the remote object matches', () => {
    const m = verifyAndComplete(started, local, { key: local.objectKey, byteSize: local.byteSize }, at);
    expect(m.status).toBe('SUCCESS');
    expect(m.remoteVerifiedAt).toBe(at);
  });

  it('FAILS when the remote object is absent', () => {
    const m = verifyAndComplete(started, local, null, at);
    expect(m.status).toBe('FAILED');
    expect(m.remoteVerifiedAt).toBeNull();
  });

  it('FAILS on a remote size mismatch', () => {
    const m = verifyAndComplete(started, local, { key: local.objectKey, byteSize: 12 }, at);
    expect(m.status).toBe('FAILED');
    expect(m.failureReason).toMatch(/does not match/);
  });

  it('FAILS on a key mismatch', () => {
    const m = verifyAndComplete(started, local, { key: 'database/daily/other.dump', byteSize: local.byteSize }, at);
    expect(m.status).toBe('FAILED');
  });

  it('FAILS on an implausibly small dump even when sizes agree', () => {
    const tiny = { ...local, byteSize: 100 };
    const m = verifyAndComplete(started, tiny, { key: tiny.objectKey, byteSize: 100 }, at);
    expect(m.status).toBe('FAILED');
    expect(m.failureReason).toMatch(/minimum/);
  });

  it('FAILS on a missing or malformed checksum', () => {
    const m = verifyAndComplete(started, { ...local, sha256: 'short' }, { key: local.objectKey, byteSize: local.byteSize }, at);
    expect(m.status).toBe('FAILED');
    expect(m.failureReason).toMatch(/[Cc]hecksum/);
  });

  it('clears any verification timestamp when a run fails', () => {
    const ok = verifyAndComplete(started, local, { key: local.objectKey, byteSize: local.byteSize }, at);
    expect(markFailed(ok, 'upload lost', at).remoteVerifiedAt).toBeNull();
  });
});

describe('a failed run never advances the last-successful marker', () => {
  const state: BackupState = {
    lastSuccessfulAt: '2026-08-26T21:04:00.000Z',
    lastSuccessfulObjectKey: 'database/daily/2026/08/yesterday.dump',
    lastAttemptAt: null,
    lastAttemptStatus: null,
  };
  const started = startManifest({
    backupId: 'b2',
    type: 'DAILY',
    environment: 'production',
    databaseName: mask(PROD_DB),
    startedAt: '2026-08-27T21:00:00.000Z',
  });

  it('records the attempt but keeps yesterday as the last success', () => {
    const failed = markFailed(started, 'pg_dump exited 1', '2026-08-27T21:01:00.000Z');
    const next = applyRun(state, failed);

    expect(next.lastAttemptStatus).toBe('FAILED');
    expect(next.lastAttemptAt).toBe('2026-08-27T21:01:00.000Z');
    // The dangerous outcome: "last successful backup: today" on a day it failed.
    expect(next.lastSuccessfulAt).toBe(state.lastSuccessfulAt);
    expect(next.lastSuccessfulObjectKey).toBe(state.lastSuccessfulObjectKey);
  });

  it('advances it only on SUCCESS', () => {
    const ok = verifyAndComplete(
      started,
      { objectKey: 'database/daily/2026/08/today.dump', byteSize: 5_000_000, sha256: 'b'.repeat(64) },
      { key: 'database/daily/2026/08/today.dump', byteSize: 5_000_000 },
      '2026-08-27T21:04:00.000Z',
    );
    expect(applyRun(state, ok).lastSuccessfulAt).toBe('2026-08-27T21:04:00.000Z');
  });
});

describe('object keys', () => {
  it('separates pre-migration into its own prefix', () => {
    const key = objectKeyFor('PRE_MIGRATION', new Date('2026-08-27T21:00:00.000Z'), 'prod');
    expect(key).toContain('database/pre-migration/2026/08/');
    expect(classifyKey(key)).toBe('PRE_MIGRATION');
  });

  it('carries no credential or personal data', () => {
    const key = objectKeyFor('DAILY', new Date('2026-08-27T21:00:00.000Z'), 'prod');
    expect(key).not.toMatch(/password|secret|@|:\/\//);
  });
});

describe('retention is timid', () => {
  const now = new Date('2026-08-27T00:00:00.000Z');
  const obj = (key: string, ageDays: number) => ({
    key,
    type: null,
    createdAt: new Date(now.getTime() - ageDays * 86_400_000).toISOString(),
    byteSize: 5_000_000,
  });

  it('deletes an expired daily backup', () => {
    const [d] = planRetention([obj('database/daily/2026/07/a.dump', 40)], now);
    expect(d.action).toBe('DELETE');
  });

  it('keeps a daily backup inside the window', () => {
    const [d] = planRetention([obj('database/daily/2026/08/a.dump', 10)], now);
    expect(d.action).toBe('KEEP');
  });

  it('never deletes a pre-migration restore point, however old', () => {
    const [d] = planRetention([obj('database/pre-migration/2025/01/a.dump', 900)], now);
    expect(d.action).toBe('KEEP');
    expect(d.reason).toMatch(/pre-migration/i);
  });

  it('never deletes a monthly archive in the daily sweep', () => {
    const [d] = planRetention([obj('database/monthly/2025/01/a.dump', 900)], now);
    expect(d.action).toBe('KEEP');
  });

  it('keeps anything it cannot classify', () => {
    const [d] = planRetention([obj('something/unknown/file.bin', 900)], now);
    expect(d.action).toBe('KEEP');
    expect(d.reason).toMatch(/cannot classify/);
  });

  it('keeps an object whose date will not parse', () => {
    const [d] = planRetention(
      [{ key: 'database/daily/a.dump', type: null, createdAt: 'not-a-date', byteSize: 1 }],
      now,
    );
    expect(d.action).toBe('KEEP');
  });

  it('refuses a sweep that would empty the vault', () => {
    const decisions = planRetention(
      [obj('database/daily/a.dump', 900), obj('database/daily/b.dump', 900)],
      now,
    );
    expect(() => assertRetentionSane(decisions)).toThrow(/every object/);
  });

  it('allows a partial sweep', () => {
    const decisions = planRetention(
      [obj('database/daily/old.dump', 900), obj('database/daily/new.dump', 2)],
      now,
    );
    expect(() => assertRetentionSane(decisions)).not.toThrow();
  });
});

describe('photo reconciliation states', () => {
  const facts = (over: Partial<Parameters<typeof assessPhoto>[0]> = {}) => ({
    evidenceId: 'ev-1',
    photoAssetId: 'asset-1',
    primaryPresent: true,
    backupPresent: true,
    ...over,
  });

  it('HEALTHY when both copies exist', () => {
    expect(assessPhoto(facts()).health).toBe('HEALTHY');
  });

  it('PRIMARY_MISSING_BACKUP_AVAILABLE when only the archive survives', () => {
    expect(assessPhoto(facts({ primaryPresent: false })).health).toBe(
      'PRIMARY_MISSING_BACKUP_AVAILABLE',
    );
  });

  it('BACKUP_MISSING when the photo is served but unprotected', () => {
    expect(assessPhoto(facts({ backupPresent: false })).health).toBe('BACKUP_MISSING');
  });

  it('BOTH_MISSING when the record claims a photo nobody can produce', () => {
    const a = assessPhoto(facts({ primaryPresent: false, backupPresent: false }));
    expect(a.health).toBe('BOTH_MISSING');
    expect(a.indeterminate).toBe(false);
  });

  it('distinguishes "no photo claimed" from a loss', () => {
    expect(assessPhoto(facts({ photoAssetId: null })).health).toBe('NO_PHOTO_CLAIMED');
  });

  it('never reports HEALTHY when a check could not complete', () => {
    const a = assessPhoto(facts({ backupPresent: null }));
    expect(a.health).not.toBe('HEALTHY');
    expect(a.indeterminate).toBe(true);
  });

  it('flags action for anything unprotected or unknown', () => {
    const s = summarise([
      assessPhoto(facts()),
      assessPhoto(facts({ evidenceId: 'ev-2', backupPresent: false })),
    ]);
    expect(s.healthy).toBe(1);
    expect(s.backupMissing).toBe(1);
    expect(s.actionRequired).toBe(true);
  });

  it('needs no action when everything is protected', () => {
    const s = summarise([assessPhoto(facts()), assessPhoto(facts({ evidenceId: 'ev-2' }))]);
    expect(s.actionRequired).toBe(false);
  });
});
