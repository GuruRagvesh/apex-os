import { writeFileSync } from 'fs';
import { proveDeletePermission, runSweep } from '../../scripts/backup/run-retention-sweep';
import {
  assertSafeRestoreTarget,
  runRestoreTest,
  type RestoreDeps,
} from '../../scripts/backup/run-restore-test';
import { BASELINE_TABLES } from '../../scripts/backup/schema-expectations';
import { TargetRefused } from '../../scripts/backup/backup-identity';
import type { Vault, VaultObjectSummary } from '../../src/modules/platform/backup-vault/r2-vault';

// Retention is the only routine job that destroys recovery points, and the
// restore test is what turns "we have backups" from a hypothesis into a fact.
// Both are driven against a fake vault so every refusal is reachable without
// credentials or a network.

const PROD_HOST = 'dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com';
const PROD_DB = 'apex_db_dugl';
const NOW = new Date('2026-08-27T00:00:00.000Z');

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function fakeVault(objects: VaultObjectSummary[], over: Partial<Vault> = {}) {
  const present = new Map(objects.map((o) => [o.key, o]));
  const removed: string[] = [];
  const vault: Vault = {
    async list(prefix) {
      return [...present.values()].filter((o) => o.key.startsWith(prefix));
    },
    async put(key, filePath) {
      const { statSync } = await import('fs');
      present.set(key, {
        key,
        byteSize: statSync(filePath).size,
        lastModified: NOW.toISOString(),
      });
    },
    async head(key) {
      const o = present.get(key);
      return o ? { key, byteSize: o.byteSize } : null;
    },
    async remove(key) {
      removed.push(key);
      present.delete(key);
    },
    async getToFile() {
      throw new Error('not used');
    },
    ...over,
  };
  return { vault, removed, present };
}

const obj = (key: string, ageDays: number, byteSize = 5_000_000): VaultObjectSummary => ({
  key,
  byteSize,
  lastModified: daysAgo(ageDays),
});

describe('retention dry run deletes nothing', () => {
  it('reports candidates without removing them', async () => {
    const { vault, removed } = fakeVault([
      obj('database/daily/2026/07/old.dump', 60),
      obj('database/daily/2026/08/new.dump', 2),
    ]);

    const report = await runSweep({ vault, now: () => NOW }, false);

    expect(report.deleteCandidates).toBe(1);
    expect(report.deleted).toBe(0);
    expect(removed).toEqual([]);
    expect(report.applied).toBe(false);
  });

  it('reports candidate bytes so the operator sees the scale', async () => {
    const { vault } = fakeVault([
      obj('database/daily/2026/07/old.dump', 60, 1234),
      obj('database/daily/2026/08/keep.dump', 1),
    ]);
    const report = await runSweep({ vault, now: () => NOW }, false);

    expect(report.candidateBytes).toBe(1234);
  });

  it('never proves delete permission during a dry run', async () => {
    // The probe writes an object. A dry run must not write anything either.
    const put = jest.fn();
    const { vault } = fakeVault(
      [obj('database/daily/2026/07/old.dump', 60), obj('database/daily/2026/08/keep.dump', 1)],
      { put },
    );
    await runSweep({ vault, now: () => NOW }, false);

    expect(put).not.toHaveBeenCalled();
  });
});

describe('retention protects what must not be rotated', () => {
  const protectedObjects = [
    obj('database/pre-migration/2025/01/a.dump', 900),
    obj('database/monthly/2025/01/a.dump', 900),
    obj('manifests/2025-01-01/x.json', 900),
    obj('state/backup-state.json', 900),
    obj('photos/2025/01/evidence.jpg', 900),
  ];

  it('keeps every protected category however old, in apply mode', async () => {
    const { vault, removed } = fakeVault([
      ...protectedObjects,
      obj('database/daily/2026/08/recent.dump', 1),
    ]);

    const report = await runSweep({ vault, now: () => NOW }, true);

    expect(removed).toEqual([]);
    expect(report.deleteCandidates).toBe(0);
  });

  it('states a deliberate reason rather than falling through to "unrecognised"', async () => {
    const { vault } = fakeVault([obj('state/backup-state.json', 900)]);
    const report = await runSweep({ vault, now: () => NOW }, false);

    expect(report.decisions[0].reason).toMatch(/last-successful/i);
    expect(report.decisions[0].reason).not.toMatch(/cannot classify/);
  });

  it('refuses a sweep that would empty the vault', async () => {
    const { vault } = fakeVault([
      obj('database/daily/2026/01/a.dump', 900),
      obj('database/daily/2026/01/b.dump', 900),
    ]);

    await expect(runSweep({ vault, now: () => NOW }, true)).rejects.toThrow(/every object/);
  });
});

describe('delete permission is proven before any real deletion', () => {
  it('round-trips a probe object and confirms it is gone', async () => {
    const { vault, removed } = fakeVault([]);
    await proveDeletePermission(vault, NOW);

    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/^probes\/delete-check-/);
  });

  it('refuses when the credential silently ignores deletes', async () => {
    // The dangerous token: put and head succeed, remove does nothing. Only the
    // absence check catches it.
    const { vault } = fakeVault([], { remove: async () => {} });

    await expect(proveDeletePermission(vault, NOW)).rejects.toThrow(/still present after delete/);
  });

  it('refuses when delete throws, and says not to widen the token', async () => {
    const { vault } = fakeVault([], {
      remove: async () => {
        throw new Error('AccessDenied');
      },
    });

    await expect(proveDeletePermission(vault, NOW)).rejects.toThrow(/rather than widening/);
  });

  it('runs the probe before deleting expired objects in apply mode', async () => {
    const order: string[] = [];
    const { vault } = fakeVault([obj('database/daily/2026/01/old.dump', 900), obj('database/daily/2026/08/new.dump', 1)], {
      put: async (key) => {
        order.push(`put:${key}`);
      },
      head: async (key) => (key.startsWith('probes/') && order.some((o) => o.startsWith('put:')) && !order.includes(`remove:${key}`) ? { key, byteSize: 30 } : null),
      remove: async (key) => {
        order.push(`remove:${key}`);
      },
    });

    await runSweep({ vault, now: () => NOW }, true);

    expect(order[0]).toMatch(/^put:probes\//);
    expect(order.some((o) => o === 'remove:database/daily/2026/01/old.dump')).toBe(true);
  });

  it('reports a failed delete instead of stopping silently', async () => {
    // The probe succeeds so the sweep proceeds; a real object then fails. One
    // failure must be reported rather than quietly skipped, because a skipped
    // object keeps accruing storage unnoticed.
    const probes = new Set<string>();
    const { vault } = fakeVault(
      [obj('database/daily/2026/01/old.dump', 900), obj('database/daily/2026/08/new.dump', 1)],
      {
        put: async (key) => {
          probes.add(key);
        },
        head: async (key) =>
          key.startsWith('probes/')
            ? probes.has(key)
              ? { key, byteSize: 30 }
              : null
            : { key, byteSize: 1 },
        remove: async (key) => {
          if (key.startsWith('probes/')) {
            probes.delete(key);
            return;
          }
          throw new Error('AccessDenied');
        },
      },
    );

    const report = await runSweep({ vault, now: () => NOW }, true);
    expect(report.deletePermissionProven).toBe(true);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain('AccessDenied');
  });
});

describe('restore destination must prove it is not production', () => {
  const safe = {
    APP_ENV: 'test',
    RESTORE_TARGET_DATABASE_URL: 'postgresql://u:p@localhost:5432/apex_restore_test',
  };

  it('accepts an obviously disposable target', () => {
    expect(assertSafeRestoreTarget(safe).database).toBe('apex_restore_test');
  });

  it('refuses APP_ENV=production', () => {
    expect(() => assertSafeRestoreTarget({ ...safe, APP_ENV: 'production' })).toThrow(TargetRefused);
  });

  it('refuses a known production host', () => {
    expect(() =>
      assertSafeRestoreTarget({
        ...safe,
        RESTORE_TARGET_DATABASE_URL: `postgresql://u:p@${PROD_HOST}:5432/${PROD_DB}`,
      }),
    ).toThrow(TargetRefused);
  });

  it('refuses a target matching EXPECTED_PRODUCTION_DB_HOST even if unrecognised otherwise', () => {
    expect(() =>
      assertSafeRestoreTarget({
        ...safe,
        RESTORE_TARGET_DATABASE_URL: 'postgresql://u:p@db.internal:5432/apex_test',
        EXPECTED_PRODUCTION_DB_HOST: 'db.internal',
      }),
    ).toThrow(/equals EXPECTED_PRODUCTION_DB_HOST/);
  });

  it('refuses an unrecognised destination rather than assuming it is safe', () => {
    expect(() =>
      assertSafeRestoreTarget({
        ...safe,
        RESTORE_TARGET_DATABASE_URL: 'postgresql://u:p@db.example.com:5432/apex_main',
      }),
    ).toThrow(/obviously disposable/);
  });
});

describe('restore test verifies before it trusts', () => {
  const env = {
    APP_ENV: 'test',
    RESTORE_TARGET_DATABASE_URL: 'postgresql://u:p@localhost:5432/apex_restore_test',
  };

  function deps(over: Partial<RestoreDeps> = {}) {
    const { vault } = fakeVault([]);
    const d: RestoreDeps = {
      vault: {
        ...vault,
        getToFile: async (_key, dest) => writeFileSync(dest, Buffer.alloc(2_000_000, 3)),
      },
      restore: async () => {},
      countRows: async () => 42,
      listTables: async () => [...BASELINE_TABLES],
      listAppliedMigrations: async () => ['20260101000000_init'],
      migrationTables: () => ({}),
      now: () => NOW,
      ...over,
    };
    return d;
  }

  it('passes when the dump restores and every table is present', async () => {
    const report = await runRestoreTest(env, 'database/daily/a.dump', null, deps());

    expect(report.restored).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(BASELINE_TABLES.length);
    expect(report.migrationCount).toBe(1);
    expect(report.appliedMigrations).toEqual(['20260101000000_init']);
  });

  it('refuses to restore when the checksum does not match', async () => {
    const restore = jest.fn();
    const report = await runRestoreTest(env, 'database/daily/a.dump', 'f'.repeat(64), deps({ restore }));

    expect(report.passed).toBe(false);
    expect(report.failureReason).toMatch(/[Cc]hecksum mismatch/);
    // Restoring unverified bytes would prove nothing about the backup.
    expect(restore).not.toHaveBeenCalled();
  });

  it('fails when a baseline table cannot be read after restore', async () => {
    const report = await runRestoreTest(
      env,
      'database/daily/a.dump',
      null,
      deps({
        countRows: async (_u, table) => {
          if (table === 'leave_requests') throw new Error('relation does not exist');
          return 10;
        },
      }),
    );

    expect(report.passed).toBe(false);
    expect(report.failureReason).toMatch(/leave_requests/);
  });

  it('fails when the restored database has no migration history', async () => {
    // A schema of unknown provenance is not a proven restore.
    const report = await runRestoreTest(
      env,
      'database/daily/a.dump',
      null,
      deps({ listAppliedMigrations: async () => [] }),
    );

    expect(report.passed).toBe(false);
    expect(report.failureReason).toMatch(/migration history/);
  });

  it('fails when pg_restore itself fails', async () => {
    const report = await runRestoreTest(
      env,
      'database/daily/a.dump',
      null,
      deps({
        restore: async () => {
          throw new Error('pg_restore: corrupt archive');
        },
      }),
    );

    expect(report.passed).toBe(false);
    expect(report.failureReason).toContain('corrupt archive');
  });

  it('checks the attendance tables that exist in every database', () => {
    // The release-only tables are handled by migration history, not this list:
    // demanding them unconditionally is exactly what broke the first real
    // production restore.
    for (const table of [
      'daily_attendance',
      'attendance_regularizations',
      'leave_requests',
      'work_sessions',
      'break_logs',
    ]) {
      expect(BASELINE_TABLES).toContain(table);
    }
    expect(BASELINE_TABLES).not.toContain('attendance_punch_evidence');
  });
});
