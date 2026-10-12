import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Vault } from '../../src/modules/platform/backup-vault/r2-vault';
import { r2Target, verifyR2Vault } from '../../scripts/backup/run-r2-verify';
import { checkReadiness, latestBackupManifest } from '../../scripts/storage-readiness/run-permanent-deletion-readiness';
import { mask } from '../../scripts/backup/backup-identity';
import { FakeDriveVault } from '../helpers/fake-drive-vault';

// The storage a permanent deletion depends on: the R2 vault holding full
// database backups, and the Google Drive vault holding encrypted archives.
// These checks are read-only (readiness) or self-cleaning (R2 health check),
// and none of them touches a user or the application database.

const STAGING_HOST = 'dpg-staging0001-a.oregon-postgres.render.com';
const STAGING_DB = 'apex_os_staging';
const STAGING_VAULT = 'apex-os-staging-backups';
const NOW = new Date('2026-10-12T12:00:00Z');

const stagingEnv = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'staging',
  DATABASE_URL: `postgresql://u:p@${STAGING_HOST}:5432/${STAGING_DB}`,
  EXPECTED_STAGING_DB_HOST: STAGING_HOST,
  EXPECTED_STAGING_DB_NAME: STAGING_DB,
  EXPECTED_STAGING_VAULT_BUCKET: STAGING_VAULT,
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: STAGING_VAULT,
  GOOGLE_DRIVE_CLIENT_ID: 'cid',
  GOOGLE_DRIVE_CLIENT_SECRET: 'csecret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'rtoken',
  GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID: 'root-folder-0001',
  GOOGLE_DRIVE_ARCHIVE_ACCOUNT: 'archive-owner@example.test',
  GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT: 'staging',
  ...over,
});

/** In-memory R2 vault with switchable failures. */
function memoryR2(opts: { wrongSize?: boolean; corrupt?: boolean; removeFails?: boolean } = {}) {
  const store = new Map<string, Buffer>();
  const writes: string[] = [];
  const vault: Vault & { store: Map<string, Buffer>; writes: string[] } = {
    store,
    writes,
    async put(key, path) {
      writes.push(`put ${key}`);
      store.set(key, readFileSync(path));
    },
    async head(key) {
      const b = store.get(key);
      return b ? { key, byteSize: b.length + (opts.wrongSize ? 1 : 0) } : null;
    },
    async getToFile(key, dest) {
      const b = store.get(key);
      if (!b) throw new Error('NoSuchKey');
      writeFileSync(dest, opts.corrupt ? Buffer.from(b.map((x) => x ^ 1)) : b);
    },
    async list(prefix) {
      return [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, byteSize: store.get(k)!.length, lastModified: NOW.toISOString() }));
    },
    async remove(key) {
      writes.push(`remove ${key}`);
      if (opts.removeFails) throw new Error('delete refused');
      store.delete(key);
    },
  };
  return vault;
}

describe('admin:r2:verify', () => {
  it('validates environment, database identity and the exact vault before touching it', () => {
    expect(r2Target(stagingEnv(), 'staging').bucket).toBe(STAGING_VAULT);
    expect(() => r2Target(stagingEnv(), 'production')).toThrow(/APP_ENV is "staging"/);
    expect(() => r2Target(stagingEnv({ R2_BUCKET: 'apex-os-production-backups', EXPECTED_STAGING_VAULT_BUCKET: 'apex-os-production-backups' }), 'staging')).toThrow(/production vault/);
    expect(() => r2Target(stagingEnv({ R2_BUCKET: 'apex-os-staging-other' }), 'staging')).toThrow(/does not match/);
    expect(() => r2Target(stagingEnv({ EXPECTED_STAGING_DB_NAME: 'other' }), 'staging')).toThrow(/Database mismatch/);
  });

  it('writes, checks size, downloads, compares SHA-256, deletes and confirms gone', async () => {
    const vault = memoryR2();
    const checks = await verifyR2Vault(vault, r2Target(stagingEnv(), 'staging'));
    expect(checks.map((c) => [c.step, c.ok])).toEqual([['target', true], ['upload', true], ['size', true], ['download', true], ['delete', true]]);
    expect(vault.store.size).toBe(0);
    // The target line names the bucket and a masked database, never credentials.
    expect(checks[0].detail).toContain(mask(STAGING_DB));
    expect(JSON.stringify(checks)).not.toMatch(/secret|u:p@/);
  });

  it.each([
    ['a corrupted download', { corrupt: true }, 'download'],
    ['a wrong remote size', { wrongSize: true }, 'size'],
  ])('fails on %s and still removes the test object', async (_l, opts, step) => {
    const vault = memoryR2(opts);
    const checks = await verifyR2Vault(vault, r2Target(stagingEnv(), 'staging'));
    expect(checks.find((c) => !c.ok)?.step).toBe(step);
    expect(vault.store.size).toBe(0);
  });

  it('reports a failed delete', async () => {
    const vault = memoryR2({ removeFails: true });
    const checks = await verifyR2Vault(vault, r2Target(stagingEnv(), 'staging'));
    expect(checks.some((c) => !c.ok)).toBe(true);
  });
});


describe('permanent-deletion storage readiness', () => {
  const DUMP_KEY = 'database/daily/2026/10/apex-os-staging-2026-10-12-0600.dump';
  const MANIFEST_KEY = 'manifests/2026-10-12/b1.json';
  const dump = Buffer.alloc(9000, 5);
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

  /** Stores a backup whose manifest describes `dump`; `stored` is what the vault actually holds. */
  function withBackup(vault: ReturnType<typeof memoryR2>, over: Record<string, unknown> = {}, stored: Buffer = dump) {
    vault.store.set(DUMP_KEY, stored);
    const manifest = {
      backupId: 'b1',
      type: 'DAILY',
      environment: 'staging',
      vaultBucket: STAGING_VAULT,
      databaseName: mask(STAGING_DB),
      serverVersion: '18.1',
      status: 'SUCCESS',
      remoteVerifiedAt: '2026-10-12T06:00:00Z',
      objectKey: DUMP_KEY,
      byteSize: dump.length,
      sha256: sha(dump),
      ...over,
    };
    vault.store.set(MANIFEST_KEY, Buffer.from(JSON.stringify(manifest)));
  }

  /** Test doubles for the local tools: a real SHA-256, and a pg_restore that accepts only the original dump. */
  function tools(over: Partial<{ verifyDump: (p: string) => Promise<void>; restoreClientMajor: () => Promise<number> }> = {}) {
    const verifyDump = jest.fn(async (p: string) => {
      if (!readFileSync(p).equals(dump)) throw new Error('input file does not appear to be a valid archive');
    });
    return {
      sha256File: async (p: string) => sha(readFileSync(p)),
      verifyDump,
      restoreClientMajor: async () => 18,
      ...over,
    };
  }

  const run = (env: NodeJS.ProcessEnv, r2: Vault, drive: FakeDriveVault, backupTools = tools()) =>
    checkReadiness({ env, environment: 'staging', now: NOW, makeR2Vault: () => r2, makeDriveVault: () => drive, backupTools });

  async function readyDrive() {
    const drive = new FakeDriveVault();
    await drive.ensureFolder('staging', []);
    return drive;
  }

  const r2Backup = (checks: { check: string; ok: boolean; detail: string }[]) => checks.find((c) => c.check === 'r2-backup')!;
  const allReady = (checks: { ok: boolean }[]) => checks.length === 6 && checks.every((c) => c.ok);

  it('is READY only for a fully verified backup: downloaded, SHA-256 matched and read by pg_restore', async () => {
    const r2 = memoryR2();
    withBackup(r2);
    const t = tools();
    const checks = await run(stagingEnv(), r2, await readyDrive(), t);
    expect(checks.map((c) => [c.check, c.ok])).toEqual([
      ['environment', true], ['r2-config', true], ['r2-backup', true], ['drive-config', true], ['drive-account', true], ['drive-private', true],
    ]);
    expect(allReady(checks)).toBe(true);
    expect(r2Backup(checks).detail).toMatch(/fully verified.*SHA-256 matches.*pg_restore --list/);
    // pg_restore ran on the downloaded bytes, which were the real dump.
    expect(t.verifyDump).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(checks)).not.toMatch(/csecret|rtoken|u:p@|"secret"/);
  });

  it('is NOT READY when the manifest and size are right but the SHA-256 is wrong', async () => {
    const r2 = memoryR2();
    withBackup(r2, { sha256: 'f'.repeat(64) });
    const t = tools();
    const checks = await run(stagingEnv(), r2, await readyDrive(), t);
    expect(r2Backup(checks)).toEqual(expect.objectContaining({ ok: false, detail: expect.stringMatching(/SHA-256 does not match/) }));
    expect(allReady(checks)).toBe(false);
    expect(t.verifyDump).not.toHaveBeenCalled();
  });

  it('is NOT READY when the dump was replaced by corrupted bytes of the same size', async () => {
    const r2 = memoryR2();
    const corrupted = Buffer.alloc(dump.length, 6);
    withBackup(r2, {}, corrupted);
    expect(corrupted.length).toBe(dump.length);
    const checks = await run(stagingEnv(), r2, await readyDrive());
    expect(r2Backup(checks)).toEqual(expect.objectContaining({ ok: false, detail: expect.stringMatching(/SHA-256 does not match/) }));
    expect(allReady(checks)).toBe(false);
  });

  it('is NOT READY when the download is corrupted in transit', async () => {
    const r2 = memoryR2({ corrupt: true });
    withBackup(r2);
    const checks = await run(stagingEnv(), r2, await readyDrive());
    expect(r2Backup(checks).ok).toBe(false);
    expect(allReady(checks)).toBe(false);
  });

  it('is NOT READY when pg_restore --list rejects the dump', async () => {
    const r2 = memoryR2();
    withBackup(r2);
    const t = tools({ verifyDump: async () => { throw new Error('pg_restore lists no table data'); } });
    const checks = await run(stagingEnv(), r2, await readyDrive(), t);
    expect(r2Backup(checks)).toEqual(expect.objectContaining({ ok: false, detail: expect.stringMatching(/pg_restore could not read/) }));
    expect(allReady(checks)).toBe(false);
  });

  it.each([
    ['pg_restore is older than the backed-up server', { restoreClientMajor: async () => 17 }, /pg_restore 17 cannot verify a dump of PostgreSQL 18/],
    ['the pg_restore version cannot be determined', { restoreClientMajor: async () => Number.NaN }, /version could not be determined/],
  ])('is NOT READY when %s', async (_l, over, msg) => {
    const r2 = memoryR2();
    withBackup(r2);
    const t = tools(over);
    const checks = await run(stagingEnv(), r2, await readyDrive(), t);
    expect(r2Backup(checks)).toEqual(expect.objectContaining({ ok: false, detail: expect.stringMatching(msg as RegExp) }));
    expect(t.verifyDump).not.toHaveBeenCalled();
  });

  it.each([
    ['the backup is of another environment', { environment: 'production' }, /no successful staging backup/],
    ['the backup is of another database', { databaseName: mask('apex_os_other') }, /different database/],
    ['the backup is in another vault', { vaultBucket: 'apex-os-staging-other' }, /different vault/],
    ['the backup records no vault', { vaultBucket: undefined }, /does not record which vault/],
    ['the backup is older than 24 hours', { remoteVerifiedAt: '2026-10-11T06:00:00Z' }, /h old/],
    ['the backup did not succeed', { status: 'FAILED' }, /no successful staging backup/],
    ['the manifest records no server version', { serverVersion: null }, /server version/],
  ])('is NOT READY when %s', async (_l, over, msg) => {
    const r2 = memoryR2();
    withBackup(r2, over);
    const checks = await run(stagingEnv(), r2, await readyDrive());
    expect(r2Backup(checks)).toEqual(expect.objectContaining({ ok: false, detail: expect.stringMatching(msg as RegExp) }));
    expect(allReady(checks)).toBe(false);
  });

  it.each([
    ['no backup exists', (_v: ReturnType<typeof memoryR2>) => undefined, /no successful staging backup/],
    ['the dump object is missing', (v: ReturnType<typeof memoryR2>) => { withBackup(v); v.store.delete(DUMP_KEY); }, /missing or the wrong size/],
    ['the dump object is the wrong size', (v: ReturnType<typeof memoryR2>) => withBackup(v, {}, dump.subarray(0, 5000)), /missing or the wrong size/],
  ])('is NOT READY when %s', async (_l, setup, msg) => {
    const r2 = memoryR2();
    setup(r2);
    const checks = await run(stagingEnv(), r2, await readyDrive());
    expect(r2Backup(checks)).toEqual(expect.objectContaining({ ok: false, detail: expect.stringMatching(msg as RegExp) }));
  });

  it.each([
    ['database', { EXPECTED_STAGING_DB_NAME: 'apex_os_other' }, /Database mismatch/],
    ['bucket', { R2_BUCKET: 'apex-os-staging-other' }, /does not match/],
    ['production-vault', { R2_BUCKET: 'apex-os-production-backups', EXPECTED_STAGING_VAULT_BUCKET: 'apex-os-production-backups' }, /production vault/],
  ])('is NOT READY on a %s target mismatch, and never reads the backup', async (_l, over, msg) => {
    const r2 = memoryR2();
    withBackup(r2);
    const t = tools();
    const checks = await run(stagingEnv(over), r2, await readyDrive(), t);
    expect(checks.find((c) => c.check === 'r2-config')).toEqual(expect.objectContaining({ ok: false, detail: expect.stringMatching(msg as RegExp) }));
    expect(r2Backup(checks).ok).toBe(false);
    expect(t.verifyDump).not.toHaveBeenCalled();
  });

  it.each([
    ['APP_ENV disagrees', { APP_ENV: 'production' }],
    ['the Drive archive environment disagrees', { GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT: 'production' }],
  ])('stops at the environment check when %s', async (_l, over) => {
    const checks = await run(stagingEnv(over), memoryR2(), await readyDrive());
    expect(checks).toEqual([expect.objectContaining({ check: 'environment', ok: false })]);
  });

  it('never writes or deletes an R2 object or a Drive file, whether ready or not', async () => {
    const setups: Array<(v: ReturnType<typeof memoryR2>) => void> = [
      (v) => withBackup(v),
      (v) => withBackup(v, { sha256: 'f'.repeat(64) }),
      (v) => withBackup(v, {}, Buffer.alloc(dump.length, 6)),
      (v) => withBackup(v, { remoteVerifiedAt: '2026-10-11T06:00:00Z' }),
    ];
    for (const setup of setups) {
      const r2 = memoryR2();
      setup(r2);
      const drive = await readyDrive();
      const before = [...r2.store.entries()].map(([k, b]) => [k, sha(b)]).sort();
      const driveBefore = drive.files.size;
      await run(stagingEnv(), r2, drive);
      expect(r2.writes).toEqual([]);
      expect([...r2.store.entries()].map(([k, b]) => [k, sha(b)]).sort()).toEqual(before);
      expect(drive.files.size).toBe(driveBefore);
      expect(drive.removed).toEqual([]);
    }
  });

  it('reports drive-config not ready when the refresh token is missing', async () => {
    const r2 = memoryR2();
    withBackup(r2);
    const checks = await run(stagingEnv({ GOOGLE_DRIVE_REFRESH_TOKEN: '' }), r2, await readyDrive());
    expect(checks.find((c) => c.check === 'drive-config')).toEqual(expect.objectContaining({ ok: false, detail: expect.stringMatching(/GOOGLE_DRIVE_REFRESH_TOKEN/) }));
  });

  it('reports drive-account not ready for another Google account', async () => {
    const r2 = memoryR2();
    withBackup(r2);
    const drive = new FakeDriveVault({ account: 'someone-else@example.test' });
    const checks = await run(stagingEnv(), r2, drive);
    expect(checks.find((c) => c.check === 'drive-account')?.ok).toBe(false);
  });

  it.each([
    ['the root is shared by link', (d: FakeDriveVault) => d.addPermission(d.rootId, { type: 'anyone', role: 'reader' }), /anyone who has the link/],
    ['the environment folder does not exist yet', (d: FakeDriveVault) => d.files.delete(d.folderAt('staging')!), /does not exist/],
  ])('reports drive-private not ready when %s, and fixes nothing', async (_l, mutate, msg) => {
    const r2 = memoryR2();
    withBackup(r2);
    const drive = await readyDrive();
    mutate(drive);
    const size = drive.files.size;
    const checks = await run(stagingEnv(), r2, drive);
    const c = checks.find((x) => x.check === 'drive-private')!;
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(msg as RegExp);
    expect(drive.files.size).toBe(size);
  });

  it('picks the newest successful manifest for this environment only', async () => {
    const r2 = memoryR2();
    withBackup(r2);
    r2.store.set('manifests/2026-10-12/prod.json', Buffer.from(JSON.stringify({ environment: 'production', status: 'SUCCESS', remoteVerifiedAt: '2026-10-12T11:00:00Z' })));
    r2.store.set('manifests/2026-10-12/failed.json', Buffer.from(JSON.stringify({ environment: 'staging', status: 'FAILED', remoteVerifiedAt: null })));
    const latest = await latestBackupManifest(r2, 'staging', NOW);
    expect(latest?.key).toBe(MANIFEST_KEY);
  });

  it('uses the shared backup verification and imports no purge or deletion module', () => {
    const src = readFileSync(join(__dirname, '../../scripts/storage-readiness/run-permanent-deletion-readiness.ts'), 'utf8');
    expect(src).toMatch(/verifyDatabaseBackup\(/);
    // No lighter, size-only path that could report ready on its own.
    expect(src).not.toMatch(/checkBackupManifest|\.head\(/);
    const imports = (src.match(/from '[^']+'/g) ?? []).join('\n');
    expect(imports).not.toMatch(/purge|candidate|archive-pipeline|users\.service|deletion/i);
    expect(src).not.toMatch(/deleteMany|\.delete\(|\.remove\(|\.put\(|putBuffer|createRoot|ensureFolder/);
  });
});
