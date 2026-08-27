import { readFileSync } from 'fs';
import { resolve } from 'path';
import { archiveObjectKey, decideArchiveAction } from '../../scripts/backup/photo-archive';
import { archivePhoto, type ArchiveDeps } from '../../scripts/backup/run-photo-archive';
import {
  reconcilePhotos,
  exitCodeForReconciliation,
  describeRun,
  type ReconcileRow,
} from '../../scripts/backup/run-photo-reconcile';
import { assessPhoto, summarise } from '../../scripts/backup/photo-reconciliation';
import type { Vault } from '../../scripts/backup/r2-vault';

const RECEIVED = new Date('2026-08-14T09:30:00Z');

describe('an evidence row whose photo record is missing is not benign', () => {
  // The query selects only rows where photoAssetId IS NOT NULL, so such a row
  // always claims a photograph. Passing photoAssetId: null to the classifier
  // filed that claim under NO_PHOTO_CLAIMED -- a state nothing acts on -- and
  // dropped genuine evidence loss out of every count that matters.

  const deps = {
    vault: {
      async head() {
        return { key: 'k', byteSize: 1000 };
      },
      async put() {},
      async getToFile() {},
      async list() {
        return [];
      },
      async remove() {},
    } as Vault,
    primaryExists: async () => true,
  };

  const row = (over: Partial<ReconcileRow> = {}): ReconcileRow => ({
    evidenceId: 'ev-1',
    photoId: 'photo-1',
    objectKey: 'cloudinary:authenticated:image:abc:jpg',
    expectedByteSize: 1000,
    receivedAt: RECEIVED,
    ...over,
  });

  it('reports a claim with no readable asset record as CHECK_FAILED', async () => {
    const [assessment] = await reconcilePhotos(
      [row({ objectKey: null, receivedAt: null })],
      deps,
    );

    expect(assessment.health).toBe('CHECK_FAILED');
    expect(assessment.indeterminate).toBe(true);
  });

  it('does not call it NO_PHOTO_CLAIMED', async () => {
    const [assessment] = await reconcilePhotos(
      [row({ objectKey: null, receivedAt: null })],
      deps,
    );

    expect(assessment.health).not.toBe('NO_PHOTO_CLAIMED');
  });

  it('counts it as requiring action', async () => {
    const assessments = await reconcilePhotos([row({ objectKey: null, receivedAt: null })], deps);
    const summary = summarise(assessments);

    expect(summary.checkFailed).toBe(1);
    expect(summary.noPhoto).toBe(0);
    expect(summary.actionRequired).toBe(true);
    expect(exitCodeForReconciliation(summary)).toBe(1);
    expect(describeRun(summary)).toBe('CRITICAL');
  });

  it('still reports a punch that genuinely claimed no photograph as benign', async () => {
    const assessments = await reconcilePhotos([row({ photoId: null })], deps);
    const summary = summarise(assessments);

    expect(assessments[0].health).toBe('NO_PHOTO_CLAIMED');
    expect(summary.actionRequired).toBe(false);
    expect(exitCodeForReconciliation(summary)).toBe(0);
  });

  it('reads the claim from the foreign key, not the joined record', () => {
    const src = readFileSync(
      resolve(__dirname, '../../scripts/backup/run-photo-reconcile.ts'),
      'utf8',
    );

    expect(src).toMatch(/photoId:\s*e\.photoAssetId/);
    expect(src).not.toMatch(/photoId:\s*e\.photoAsset\?\.id/);
  });
});

describe('archiving is idempotent and never overwrites', () => {
  it('skips an archive copy that is already the right size', () => {
    expect(decideArchiveAction({ byteSize: 1000 }, { byteSize: 1000 })).toBe(
      'SKIP_ALREADY_CORRECT',
    );
  });

  it('refuses when an existing copy disagrees about size', () => {
    // A punch photograph is immutable, so a different size is not a stale
    // copy to refresh -- it is two things claiming to be the same evidence.
    expect(decideArchiveAction({ byteSize: 1000 }, { byteSize: 2048 })).toBe('REFUSE_MISMATCH');
  });

  it('uploads when nothing is there', () => {
    expect(decideArchiveAction({ byteSize: 1000 }, null)).toBe('UPLOAD');
  });

  it('never calls put() when an existing object disagrees', async () => {
    const puts: string[] = [];
    const deps: ArchiveDeps = {
      vault: {
        async head() {
          return { key: 'k', byteSize: 999 };
        },
        async put(key) {
          puts.push(key);
        },
        async getToFile() {},
        async list() {
          return [];
        },
        async remove() {},
      },
      signedUrlFor: () => 'https://signed.example/never-used',
      download: async () => {
        throw new Error('download must not be attempted');
      },
      now: () => new Date(),
    };

    const result = await archivePhoto(
      {
        id: 'photo-1',
        objectKey: 'cloudinary:authenticated:image:abc:jpg',
        sha256: 'a'.repeat(64),
        byteSize: 1000,
        receivedAt: RECEIVED,
      },
      deps,
    );

    expect(result.outcome).toBe('INTEGRITY_MISMATCH');
    expect(puts).toEqual([]);
  });
});

describe('reconciliation states keep distinct meanings', () => {
  const facts = (over: any = {}) => ({
    evidenceId: 'ev-1',
    photoAssetId: 'photo-1',
    primaryPresent: true,
    backupPresent: true,
    ...over,
  });

  it('BOTH_MISSING is a photograph nobody can produce', () => {
    expect(assessPhoto(facts({ primaryPresent: false, backupPresent: false })).health).toBe(
      'BOTH_MISSING',
    );
  });

  it('PRIMARY_MISSING_BACKUP_AVAILABLE means recovery is still possible', () => {
    expect(assessPhoto(facts({ primaryPresent: false })).health).toBe(
      'PRIMARY_MISSING_BACKUP_AVAILABLE',
    );
  });

  it('an outage is CHECK_FAILED, never a loss', () => {
    expect(assessPhoto(facts({ primaryPresent: null })).health).toBe('CHECK_FAILED');
    expect(assessPhoto(facts({ backupPresent: null })).health).toBe('CHECK_FAILED');
  });

  it('disagreeing sizes are an INTEGRITY_MISMATCH', () => {
    expect(
      assessPhoto(facts({ expectedByteSize: 1000, archiveByteSize: 2048 })).health,
    ).toBe('INTEGRITY_MISMATCH');
  });

  it('strict mode treats unprotected evidence as failure', () => {
    const summary = summarise([
      assessPhoto(facts({ backupPresent: false })), // BACKUP_MISSING
    ]);

    expect(exitCodeForReconciliation(summary, false)).toBe(0);
    expect(exitCodeForReconciliation(summary, true)).toBe(1);
    expect(describeRun(summary, true)).toBe('UNPROTECTED EVIDENCE');
  });

  it('critical states fail in both modes', () => {
    const summary = summarise([assessPhoto(facts({ primaryPresent: false, backupPresent: false }))]);

    expect(exitCodeForReconciliation(summary, false)).toBe(1);
    expect(exitCodeForReconciliation(summary, true)).toBe(1);
  });
});

describe('the archive stays out of the live punch path', () => {
  it('is not invoked from application code', () => {
    // If archiving ran inside the punch transaction, an R2 outage would stop
    // employees clocking in. Walked in Node rather than shelled out to grep,
    // so the check cannot pass merely because the command failed to run.
    const { readdirSync, statSync } = require('fs');
    const srcRoot = resolve(__dirname, '../../src');

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry: string) => {
        const full = resolve(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });

    const files = walk(srcRoot).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(50); // the walk really ran

    const hits = files.filter((f) =>
      /runPhotoArchive|archivePhoto\(/.test(readFileSync(f, 'utf8')),
    );

    expect(hits).toEqual([]);
  });

  it('mints a short-lived signed URL and neither stores nor logs it', () => {
    const src = readFileSync(
      resolve(__dirname, '../../scripts/backup/run-photo-archive.ts'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).toMatch(/expires_at:/);
    expect(code).toMatch(/sign_url:\s*true/);
    // Never printed, never persisted.
    expect(code).not.toMatch(/console\.\w+\([^)]*\burl\b/);
    expect(code).not.toMatch(/signedUrl.*=.*await prisma/);
  });

  it('keys archives deterministically by photo id', () => {
    expect(archiveObjectKey({ id: 'clx1', receivedAt: RECEIVED })).toBe(
      'attendance-photos/2026/08/clx1',
    );
    // Same input, same key: re-running cannot create a second copy.
    expect(archiveObjectKey({ id: 'clx1', receivedAt: RECEIVED })).toBe(
      archiveObjectKey({ id: 'clx1', receivedAt: RECEIVED }),
    );
  });
});
