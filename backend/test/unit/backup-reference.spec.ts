import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import {
  checkBackupManifest,
  verifyDatabaseBackup,
  type BackupVerifyDeps,
} from '../../scripts/backup/verify-backup-reference';
import { mask } from '../../scripts/backup/backup-identity';

// Permanent deletion requires a recent, complete, same-environment database
// backup. The proof is cryptographic: the dump is downloaded, its SHA-256 is
// recomputed and compared with the manifest, and pg_restore must read it.

describe('database backup reference', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const dump = Buffer.alloc(9000, 3);
  const dumpSha = createHash('sha256').update(dump).digest('hex');
  const KEY = 'manifests/2026-10-09/abc-123.json';
  const DUMP_KEY = 'database/daily/2026/10/apex-os-prod-2026-10-09-0600.dump';
  const expected = { environment: 'production', database: 'apex_db_dugl', bucket: 'apex-os-production-backups', now };

  const goodManifest = (over: any = {}) => ({
    backupId: 'abc-123',
    type: 'DAILY',
    environment: 'production',
    vaultBucket: 'apex-os-production-backups',
    databaseName: mask('apex_db_dugl'),
    serverVersion: '18.1',
    status: 'SUCCESS',
    remoteVerifiedAt: '2026-10-09T06:00:00Z',
    objectKey: DUMP_KEY,
    byteSize: dump.length,
    sha256: dumpSha,
    ...over,
  });

  function depsFor(manifestJson: any, stored: Buffer = dump, over: Partial<BackupVerifyDeps> = {}) {
    const objects = new Map<string, Buffer>([
      [KEY, Buffer.from(JSON.stringify(manifestJson))],
      [DUMP_KEY, stored],
    ]);
    const verifyDump = jest.fn(async () => {});
    const deps: BackupVerifyDeps = {
      vault: {
        put: async () => {},
        head: async (k) => (objects.has(k) ? { key: k, byteSize: objects.get(k)!.length } : null),
        getToFile: async (k, dest) => {
          if (!objects.has(k)) throw new Error('NoSuchKey');
          writeFileSync(dest, objects.get(k)!);
        },
        list: async () => [],
        remove: async () => {},
      },
      sha256File: async (p) => createHash('sha256').update(readFileSync(p)).digest('hex'),
      verifyDump,
      restoreClientMajor: async () => 18,
      ...over,
    };
    return { deps, verifyDump };
  }

  it('accepts a dump whose computed SHA-256 matches and that pg_restore can read', async () => {
    const { deps, verifyDump } = depsFor(goodManifest());
    const r = await verifyDatabaseBackup(deps, KEY, expected);
    expect(r.computedSha256).toBe(dumpSha);
    expect(verifyDump).toHaveBeenCalledTimes(1);
  });

  it('refuses when the bytes in the vault hash differently from the manifest', async () => {
    const tampered = Buffer.alloc(9000, 4); // same size, different content
    const { deps } = depsFor(goodManifest(), tampered);
    await expect(verifyDatabaseBackup(deps, KEY, expected)).rejects.toThrow(/SHA-256 does not match/);
  });

  it('refuses when the manifest records no hash', async () => {
    const { deps } = depsFor(goodManifest({ sha256: null }));
    await expect(verifyDatabaseBackup(deps, KEY, expected)).rejects.toThrow(/no valid SHA-256/);
  });

  it('refuses a dump whose size differs from the manifest (incomplete object)', async () => {
    const { deps } = depsFor(goodManifest(), dump.subarray(0, 5000));
    await expect(verifyDatabaseBackup(deps, KEY, expected)).rejects.toThrow(/wrong size|incomplete/);
  });

  it('refuses when pg_restore cannot read the dump', async () => {
    const { deps } = depsFor(goodManifest(), dump, {
      verifyDump: async () => {
        throw new Error('input file does not appear to be a valid archive');
      },
    });
    await expect(verifyDatabaseBackup(deps, KEY, expected)).rejects.toThrow(/pg_restore could not read/);
  });

  it.each([
    ['an older pg_restore than the server', { restoreClientMajor: async () => 17 }, /pg_restore 17 cannot verify a dump of PostgreSQL 18/],
    ['an unknown pg_restore version', { restoreClientMajor: async () => Number.NaN }, /pg_restore version could not be determined/],
    ['a pg_restore that cannot report its version', { restoreClientMajor: async () => { throw new Error('pg_restore: not found'); } }, /pg_restore version could not be determined/],
  ])('refuses %s before running pg_restore --list', async (_l, over, msg) => {
    const { deps, verifyDump } = depsFor(goodManifest(), dump, over as Partial<BackupVerifyDeps>);
    await expect(verifyDatabaseBackup(deps, KEY, expected)).rejects.toThrow(msg as RegExp);
    expect(verifyDump).not.toHaveBeenCalled();
  });

  it('refuses a manifest that does not record the server version', async () => {
    const { deps } = depsFor(goodManifest({ serverVersion: null }));
    await expect(verifyDatabaseBackup(deps, KEY, expected)).rejects.toThrow(/server version/);
  });

  it('accepts a newer pg_restore than the server', async () => {
    const { deps } = depsFor(goodManifest(), dump, { restoreClientMajor: async () => 19 });
    await expect(verifyDatabaseBackup(deps, KEY, expected)).resolves.toBeDefined();
  });

  it.each([
    ['wrong database', { databaseName: mask('another_database') }, /different database/],
    ['wrong environment', { environment: 'staging' }, /is of staging/],
    ['wrong vault', { vaultBucket: 'apex-os-staging-backups' }, /different vault/],
    ['vault not recorded', { vaultBucket: undefined }, /does not record which vault/],
    ['expired backup', { remoteVerifiedAt: '2026-10-07T00:00:00Z' }, /h old/],
    ['failed backup', { status: 'FAILED' }, /did not succeed/],
    ['unverified backup', { remoteVerifiedAt: null }, /never verified/],
    ['missing dump object', { objectKey: null }, /no dump object/],
  ])('refuses a %s before downloading anything', (_l, over, msg) => {
    expect(() => checkBackupManifest(goodManifest(over) as any, { ...expected, maxAgeHours: 24 })).toThrow(msg as RegExp);
  });

  it('refuses a reference that is not a manifest key', async () => {
    const { deps } = depsFor(goodManifest());
    await expect(verifyDatabaseBackup(deps, 'render-snapshot-screenshot.png', expected)).rejects.toThrow(/manifest key/);
    await expect(verifyDatabaseBackup(deps, DUMP_KEY, expected)).rejects.toThrow(/manifest key/);
  });
});
