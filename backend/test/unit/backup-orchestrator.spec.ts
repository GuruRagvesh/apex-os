import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  exitCodeFor,
  majorVersion,
  runBackup,
  type BackupDeps,
} from '../../scripts/backup/run-database-backup';
import { readR2Config, VaultNotConfigured, type Vault } from '../../scripts/backup/r2-vault';
import type { BackupState } from '../../scripts/backup/backup-manifest';

// The orchestrator decides whether a run counts as a backup. These tests drive
// it against a fake vault so every failure path is exercised without
// credentials, a network, or a database — and so the paths that matter most
// (the ones where something goes wrong) are actually reachable.

const PROD_HOST = 'dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com';
const PROD_DB = 'apex_db_dugl';

const prodEnv = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'production',
  DATABASE_URL: `postgresql://u:p@${PROD_HOST}:5432/${PROD_DB}`,
  EXPECTED_PRODUCTION_DB_HOST: PROD_HOST,
  EXPECTED_PRODUCTION_DB_NAME: PROD_DB,
  ...over,
});

const EXISTING_STATE: BackupState = {
  lastSuccessfulAt: '2026-08-26T21:04:00.000Z',
  lastSuccessfulObjectKey: 'database/daily/2026/08/yesterday.dump',
  lastAttemptAt: '2026-08-26T21:04:00.000Z',
  lastAttemptStatus: 'SUCCESS',
};

/** A vault that records what it was asked to do. */
function fakeVault(over: Partial<Vault> = {}) {
  const stored = new Map<string, number>();
  const vault: Vault = {
    async put(key, filePath) {
      const { statSync } = await import('fs');
      stored.set(key, statSync(filePath).size);
    },
    async head(key) {
      const size = stored.get(key);
      return size === undefined ? null : { key, byteSize: size };
    },
    async getToFile() {
      throw new Error('not used');
    },
    async list() {
      return [];
    },
    async remove() {},
    ...over,
  };
  return { vault, stored };
}

/** Writes a plausible dump so size and checksum checks are meaningful. */
function makeDeps(over: Partial<BackupDeps> = {}) {
  const { vault, stored } = fakeVault();
  const savedManifests: any[] = [];
  let savedState: BackupState | null = null;

  const deps: BackupDeps = {
    vault,
    dump: async (_url, outPath) => writeFileSync(outPath, Buffer.alloc(2_000_000, 7)),
    serverVersion: async () => '18.4',
    clientMajorVersion: async () => 18,
    now: () => new Date('2026-08-27T21:00:00.000Z'),
    loadState: async () => EXISTING_STATE,
    saveState: async (s) => {
      savedState = s;
    },
    saveManifest: async (m) => {
      savedManifests.push(m);
    },
    ...over,
  };
  return { deps, stored, savedManifests, getState: () => savedState };
}

describe('vault configuration', () => {
  it('refuses to run when the vault is not configured', () => {
    expect(() => readR2Config({})).toThrow(VaultNotConfigured);
  });

  it('names every missing variable rather than only the first', () => {
    try {
      readR2Config({ R2_ACCOUNT_ID: 'acct' });
      throw new Error('should have refused');
    } catch (err: any) {
      expect(err.message).toContain('R2_ACCESS_KEY_ID');
      expect(err.message).toContain('R2_SECRET_ACCESS_KEY');
      expect(err.message).toContain('R2_BUCKET');
      expect(err.message).not.toContain('R2_ACCOUNT_ID,');
    }
  });

  it('rejects whitespace-only configuration', () => {
    expect(() =>
      readR2Config({
        R2_ACCOUNT_ID: '  ',
        R2_ACCESS_KEY_ID: 'k',
        R2_SECRET_ACCESS_KEY: 's',
        R2_BUCKET: 'b',
      }),
    ).toThrow(VaultNotConfigured);
  });
});

describe('a verified remote copy is the only route to SUCCESS', () => {
  it('succeeds and advances the last-successful marker', async () => {
    const { deps, getState } = makeDeps();
    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);

    expect(manifest.status).toBe('SUCCESS');
    expect(manifest.remoteVerifiedAt).toBe('2026-08-27T21:00:00.000Z');
    expect(manifest.sha256).toHaveLength(64);
    expect(getState()!.lastSuccessfulAt).toBe('2026-08-27T21:00:00.000Z');
  });

  it('FAILS when the upload throws, and keeps yesterday as last successful', async () => {
    const { vault } = fakeVault({
      put: async () => {
        throw new Error('network reset');
      },
    });
    const { deps, getState } = makeDeps({ vault });
    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);

    expect(manifest.status).toBe('FAILED');
    expect(manifest.failureReason).toContain('network reset');
    expect(getState()!.lastSuccessfulAt).toBe(EXISTING_STATE.lastSuccessfulAt);
  });

  it('FAILS when the object is absent after a silent upload', async () => {
    // The dangerous case: put() resolves but nothing is there.
    const { vault } = fakeVault({ put: async () => {}, head: async () => null });
    const { deps, getState } = makeDeps({ vault });
    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);

    expect(manifest.status).toBe('FAILED');
    expect(manifest.failureReason).toMatch(/not found/i);
    expect(getState()!.lastSuccessfulAt).toBe(EXISTING_STATE.lastSuccessfulAt);
  });

  it('FAILS on a remote size mismatch', async () => {
    const { vault } = fakeVault({
      put: async () => {},
      head: async (key) => ({ key, byteSize: 12 }),
    });
    const { deps } = makeDeps({ vault });
    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);

    expect(manifest.status).toBe('FAILED');
    expect(manifest.failureReason).toMatch(/does not match/);
  });

  it('FAILS on an implausibly small dump', async () => {
    const { deps } = makeDeps({
      dump: async (_u, outPath) => writeFileSync(outPath, 'tiny'),
    });
    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);

    expect(manifest.status).toBe('FAILED');
    expect(manifest.failureReason).toMatch(/minimum/);
  });

  it('FAILS when pg_dump itself fails', async () => {
    const { deps } = makeDeps({
      dump: async () => {
        throw new Error('pg_dump: connection refused');
      },
    });
    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);

    expect(manifest.status).toBe('FAILED');
    expect(manifest.failureReason).toContain('connection refused');
  });

  it('records the failure rather than only throwing', async () => {
    // A failure that leaves no manifest is invisible the next morning.
    const { deps, savedManifests } = makeDeps({
      dump: async () => {
        throw new Error('boom');
      },
    });
    await runBackup(prodEnv(), 'DAILY', deps);

    expect(savedManifests).toHaveLength(1);
    expect(savedManifests[0].status).toBe('FAILED');
  });
});

describe('identity and version are proven before any dump', () => {
  it('refuses a non-production APP_ENV without dumping', async () => {
    const dump = jest.fn();
    const { deps } = makeDeps({ dump });
    const { manifest } = await runBackup(prodEnv({ APP_ENV: 'staging' }), 'DAILY', deps);

    expect(manifest.status).toBe('FAILED');
    expect(dump).not.toHaveBeenCalled();
  });

  it('refuses a host mismatch without dumping', async () => {
    const dump = jest.fn();
    const { deps } = makeDeps({ dump });
    const { manifest } = await runBackup(
      prodEnv({ EXPECTED_PRODUCTION_DB_HOST: 'elsewhere.render.com' }),
      'DAILY',
      deps,
    );

    expect(manifest.status).toBe('FAILED');
    expect(dump).not.toHaveBeenCalled();
  });

  it('refuses when pg_dump is older than the server', async () => {
    // An older client cannot dump a newer server, and discovering that
    // mid-window is the wrong moment.
    const dump = jest.fn();
    const { deps } = makeDeps({ dump, serverVersion: async () => '18.4', clientMajorVersion: async () => 16 });
    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);

    expect(manifest.status).toBe('FAILED');
    expect(manifest.failureReason).toMatch(/cannot dump a PostgreSQL 18 server/);
    expect(dump).not.toHaveBeenCalled();
  });

  it('allows a newer client than the server', async () => {
    const { deps } = makeDeps({ serverVersion: async () => '16.2', clientMajorVersion: async () => 18 });
    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);

    expect(manifest.status).toBe('SUCCESS');
  });

  it('does not guess the production version from staging', async () => {
    // The version must be read from the target itself.
    const serverVersion = jest.fn(async () => '18.4');
    const { deps } = makeDeps({ serverVersion });
    await runBackup(prodEnv(), 'DAILY', deps);

    expect(serverVersion).toHaveBeenCalledWith(prodEnv().DATABASE_URL);
  });

  it('parses a major version from assorted strings', () => {
    expect(majorVersion('18.4')).toBe(18);
    expect(majorVersion('16.2 (Debian)')).toBe(16);
    expect(Number.isNaN(majorVersion('unknown'))).toBe(true);
  });
});

describe('temporary files never outlive the run', () => {
  const countWorkDirs = () =>
    readdirSync(tmpdir()).filter((n) => n.startsWith('apex-backup-')).length;

  it('cleans up after a successful run', async () => {
    const before = countWorkDirs();
    const { deps } = makeDeps();
    await runBackup(prodEnv(), 'DAILY', deps);

    expect(countWorkDirs()).toBe(before);
  });

  it('cleans up after a failed upload', async () => {
    const before = countWorkDirs();
    const { vault } = fakeVault({
      put: async () => {
        throw new Error('upload died');
      },
    });
    const { deps } = makeDeps({ vault });
    await runBackup(prodEnv(), 'DAILY', deps);

    // The dump is not the backup; leaving it behind only risks filling an
    // ephemeral disk mid-job.
    expect(countWorkDirs()).toBe(before);
  });
});

describe('object placement', () => {
  it('puts a pre-migration backup in its own prefix', async () => {
    const { deps, stored } = makeDeps();
    const { manifest } = await runBackup(prodEnv(), 'PRE_MIGRATION', deps);

    expect(manifest.status).toBe('SUCCESS');
    expect(manifest.objectKey).toContain('database/pre-migration/');
    expect([...stored.keys()][0]).toContain('pre-migration');
  });

  it('never records the real database name in the manifest', async () => {
    const { deps } = makeDeps();
    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);

    expect(manifest.databaseName).not.toBe(PROD_DB);
    expect(JSON.stringify(manifest)).not.toContain('u:p@');
  });
});

describe('durable manifest and state are part of the success contract', () => {
  it('FAILS when the manifest cannot be persisted, even though the dump uploaded', () => {
    // The dump object alone is not a usable backup: without a durable record
    // there is nothing saying what was taken or whether last night worked.
    return (async () => {
      const { deps } = makeDeps({
        saveManifest: async () => {
          throw new Error('vault write denied');
        },
      });
      const { manifest, state } = await runBackup(prodEnv(), 'DAILY', deps);

      expect(manifest.status).toBe('FAILED');
      expect(manifest.failureReason).toMatch(/could not be persisted/);
      expect(state.lastSuccessfulAt).toBe(EXISTING_STATE.lastSuccessfulAt);
    })();
  });

  it('FAILS when the last-successful marker cannot be persisted', async () => {
    const { deps } = makeDeps({
      saveState: async () => {
        throw new Error('state write denied');
      },
    });
    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);

    expect(manifest.status).toBe('FAILED');
  });

  it('still reports FAILED when the failure record itself cannot be written', async () => {
    // If the vault is what is broken, recording the failure fails too. Losing
    // the record must not lose the signal.
    const { deps } = makeDeps({
      dump: async () => {
        throw new Error('pg_dump died');
      },
      saveManifest: async () => {
        throw new Error('vault unreachable');
      },
      saveState: async () => {
        throw new Error('vault unreachable');
      },
    });

    const { manifest } = await runBackup(prodEnv(), 'DAILY', deps);
    expect(manifest.status).toBe('FAILED');
  });
});

describe('process exit code agrees with the manifest', () => {
  it('exits zero only on SUCCESS', () => {
    expect(exitCodeFor('SUCCESS')).toBe(0);
  });

  it('exits non-zero on FAILED', () => {
    // A FAILED manifest with exit 0 is the worst combination: the scheduler
    // marks the run successful and nobody looks until a restore is needed.
    expect(exitCodeFor('FAILED')).not.toBe(0);
  });

  it('exits non-zero on a run that never finished', () => {
    expect(exitCodeFor('RUNNING')).not.toBe(0);
  });
});
