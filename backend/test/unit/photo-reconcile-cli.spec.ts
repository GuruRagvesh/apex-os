import {
  describeRun,
  exitCodeForReconciliation,
  reconcilePhotos,
  type ReconcileDeps,
  type ReconcileRow,
} from '../../scripts/backup/run-photo-reconcile';
import { summarise } from '../../scripts/backup/photo-reconciliation';
import type { Vault } from '../../scripts/backup/r2-vault';

// A reporting tool. It must never repair, delete or overwrite, and it must
// never let an unanswered question pass as a clean bill of health.

const row = (over: Partial<ReconcileRow> = {}): ReconcileRow => ({
  evidenceId: 'ev-1',
  photoId: 'clx0photo00001',
  objectKey: 'cloudinary:authenticated:image:apex%2Fpunch%2Fabc:jpg',
  expectedByteSize: 120_000,
  receivedAt: new Date('2026-08-26T06:42:00.000Z'),
  ...over,
});

function deps(over: Partial<ReconcileDeps> = {}) {
  const vault: Vault = {
    async head(key) {
      return { key, byteSize: 120_000 };
    },
    async put() {
      throw new Error('reconciliation must never write');
    },
    async remove() {
      throw new Error('reconciliation must never delete');
    },
    async getToFile() {
      throw new Error('reconciliation must never download');
    },
    async list() {
      return [];
    },
  };
  return { vault, primaryExists: async () => true, ...over } as ReconcileDeps;
}

const run = async (rows: ReconcileRow[], d: ReconcileDeps) => summarise(await reconcilePhotos(rows, d));

describe('reconciliation reports without changing anything', () => {
  it('reports HEALTHY when both copies exist and agree', async () => {
    const s = await run([row()], deps());

    expect(s.healthy).toBe(1);
    expect(s.actionRequired).toBe(false);
  });

  it('never writes, deletes or downloads', async () => {
    // The fake vault throws on all three; a full pass must never reach them.
    const s = await run([row(), row({ evidenceId: 'ev-2' })], deps());

    expect(s.total).toBe(2);
  });

  it('reports BACKUP_MISSING when the archive is absent', async () => {
    const s = await run([row()], deps({ vault: { ...deps().vault, head: async () => null } }));

    expect(s.backupMissing).toBe(1);
  });

  it('reports PRIMARY_MISSING_BACKUP_AVAILABLE without restoring it', async () => {
    // Recovery is possible; performing it stays a deliberate act.
    const s = await run([row()], deps({ primaryExists: async () => false }));

    expect(s.primaryMissing).toBe(1);
  });

  it('reports BOTH_MISSING on its own', async () => {
    const s = await run(
      [row()],
      deps({ primaryExists: async () => false, vault: { ...deps().vault, head: async () => null } }),
    );

    expect(s.bothMissing).toBe(1);
  });

  it('reports INTEGRITY_MISMATCH when the sizes disagree', async () => {
    const s = await run(
      [row()],
      deps({ vault: { ...deps().vault, head: async (key) => ({ key, byteSize: 99 }) } }),
    );

    expect(s.integrityMismatch).toBe(1);
  });
});

describe('an outage is never data loss', () => {
  it('CHECK_FAILED when Cloudinary cannot answer', async () => {
    const s = await run([row()], deps({ primaryExists: async () => null }));

    expect(s.checkFailed).toBe(1);
    expect(s.primaryMissing).toBe(0);
    expect(s.bothMissing).toBe(0);
  });

  it('CHECK_FAILED when R2 throws, rather than BACKUP_MISSING', async () => {
    const s = await run(
      [row()],
      deps({
        vault: {
          ...deps().vault,
          head: async () => {
            throw new Error('R2 unreachable');
          },
        },
      }),
    );

    expect(s.checkFailed).toBe(1);
    expect(s.backupMissing).toBe(0);
  });

  it('treats a row with no photo record as unclaimed, not missing', async () => {
    const s = await run([row({ photoId: null, objectKey: null, receivedAt: null })], deps());

    expect(s.bothMissing).toBe(0);
  });
});

describe('exit semantics', () => {
  const summaryOf = (over: Partial<ReturnType<typeof summarise>> = {}) =>
    ({
      total: 1,
      healthy: 1,
      primaryMissing: 0,
      backupMissing: 0,
      bothMissing: 0,
      integrityMismatch: 0,
      checkFailed: 0,
      noPhoto: 0,
      indeterminate: 0,
      actionRequired: false,
      ...over,
    }) as ReturnType<typeof summarise>;

  it('exits zero when everything is healthy', () => {
    expect(exitCodeForReconciliation(summaryOf())).toBe(0);
    expect(describeRun(summaryOf())).toBe('HEALTHY');
  });

  it('exits non-zero on BOTH_MISSING', () => {
    expect(exitCodeForReconciliation(summaryOf({ bothMissing: 1 }))).not.toBe(0);
  });

  it('exits non-zero on INTEGRITY_MISMATCH', () => {
    expect(exitCodeForReconciliation(summaryOf({ integrityMismatch: 1 }))).not.toBe(0);
  });

  it('exits non-zero on CHECK_FAILED', () => {
    // An unanswered question must not pass as a clean bill of health.
    expect(exitCodeForReconciliation(summaryOf({ checkFailed: 1 }))).not.toBe(0);
  });

  it('does not fail the run for BACKUP_MISSING alone', () => {
    // Every photograph captured before archiving existed is BACKUP_MISSING, so
    // failing on it would make the first honest run look broken.
    expect(exitCodeForReconciliation(summaryOf({ healthy: 0, backupMissing: 3 }))).toBe(0);
  });

  it('still refuses to call a BACKUP_MISSING run healthy', () => {
    expect(describeRun(summaryOf({ healthy: 0, backupMissing: 3 }))).toBe('ACTION REQUIRED');
  });

  it('describes a critical run as critical, not merely action required', () => {
    expect(describeRun(summaryOf({ checkFailed: 1 }))).toBe('CRITICAL');
  });
});

describe('strict mode for steady-state reconciliation', () => {
  const summaryOf = (over: Partial<ReturnType<typeof summarise>> = {}) =>
    ({
      total: 1,
      healthy: 1,
      primaryMissing: 0,
      backupMissing: 0,
      bothMissing: 0,
      integrityMismatch: 0,
      checkFailed: 0,
      noPhoto: 0,
      indeterminate: 0,
      actionRequired: false,
      ...over,
    }) as ReturnType<typeof summarise>;

  it('still exits zero when everything is healthy', () => {
    expect(exitCodeForReconciliation(summaryOf(), true)).toBe(0);
    expect(describeRun(summaryOf(), true)).toBe('HEALTHY');
  });

  it('fails on BACKUP_MISSING, which backfill mode tolerates', () => {
    // Once everything is archived, a photograph without an independent copy is
    // not history -- it is new evidence that was never protected.
    const s = summaryOf({ healthy: 0, backupMissing: 1 });

    expect(exitCodeForReconciliation(s, false)).toBe(0);
    expect(exitCodeForReconciliation(s, true)).toBe(1);
  });

  it('fails on PRIMARY_MISSING_BACKUP_AVAILABLE', () => {
    expect(exitCodeForReconciliation(summaryOf({ healthy: 0, primaryMissing: 1 }), true)).toBe(1);
  });

  it('names unprotected evidence differently from ordinary backfill work', () => {
    const s = summaryOf({ healthy: 0, backupMissing: 2 });

    expect(describeRun(s, false)).toBe('ACTION REQUIRED');
    expect(describeRun(s, true)).toBe('UNPROTECTED EVIDENCE');
  });

  it('keeps the critical states critical in both modes', () => {
    for (const over of [{ bothMissing: 1 }, { integrityMismatch: 1 }, { checkFailed: 1 }]) {
      expect(exitCodeForReconciliation(summaryOf(over), false)).toBe(1);
      expect(exitCodeForReconciliation(summaryOf(over), true)).toBe(1);
      expect(describeRun(summaryOf(over), true)).toBe('CRITICAL');
    }
  });

  it('does not treat a row with no photo as unprotected', () => {
    // Nothing was ever claimed, so there is nothing to protect.
    expect(exitCodeForReconciliation(summaryOf({ healthy: 0, noPhoto: 5 }), true)).toBe(0);
  });
});
