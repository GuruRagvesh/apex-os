import { writeFileSync } from 'fs';
import {
  archiveObjectKey,
  decideArchiveAction,
  summariseArchive,
  type PhotoRecord,
} from '../../scripts/backup/photo-archive';
import { archivePhoto, type ArchiveDeps } from '../../scripts/backup/run-photo-archive';
import { assessPhoto, summarise } from '../../scripts/backup/photo-reconciliation';
import type { Vault } from '../../src/modules/platform/backup-vault/r2-vault';

// Punch photographs are attendance evidence. The failure that matters is
// reporting an outage as data loss, or overwriting one copy of an immutable
// photograph with another. Neither runner deletes or repairs anything.

/** The real SHA-256 of the bytes the fake download writes below. */
const SHA = '853534f237ce9adbd671689713b77b1ccdf0cb490c04494e12dc4912f1e37191';

const photo = (over: Partial<PhotoRecord> = {}): PhotoRecord => ({
  id: 'clx0photo00001',
  objectKey: 'cloudinary:authenticated:image:apex%2Fattendance%2Fpunch%2Fu1%2Fabc:jpg',
  sha256: SHA,
  byteSize: 120_000,
  receivedAt: new Date('2026-08-26T06:42:00.000Z'),
  ...over,
});

function deps(over: Partial<ArchiveDeps> = {}) {
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
    async remove() {
      throw new Error('archive runners must never delete');
    },
  };

  const d: ArchiveDeps = {
    vault,
    signedUrlFor: () => 'https://res.cloudinary.com/signed?expires=1',
    download: async (_url, dest) => writeFileSync(dest, Buffer.alloc(120_000, 1)),
    now: () => new Date('2026-08-27T21:00:00.000Z'),
    ...over,
  };
  return { deps: d, stored, vault };
}

describe('archive object keys carry nothing personal', () => {
  it('is built from the photo id and its month only', () => {
    expect(archiveObjectKey(photo())).toBe('attendance-photos/2026/08/clx0photo00001');
  });

  it('contains no email, name or coordinates', () => {
    const key = archiveObjectKey(photo());
    expect(key).not.toMatch(/@|\.com|\d{2}\.\d{4,}/);
  });

  it('is deterministic, so a rerun addresses the same object', () => {
    expect(archiveObjectKey(photo())).toBe(archiveObjectKey(photo()));
  });
});

describe('idempotency without overwriting evidence', () => {
  it('uploads when nothing is archived yet', () => {
    expect(decideArchiveAction({ byteSize: 100 }, null)).toBe('UPLOAD');
  });

  it('skips when the archive is already the right size', () => {
    expect(decideArchiveAction({ byteSize: 100 }, { byteSize: 100 })).toBe('SKIP_ALREADY_CORRECT');
  });

  it('refuses rather than overwriting a differing archive', () => {
    // A punch photograph is immutable, so a different size means two things
    // claim to be the same evidence. Overwriting destroys whichever was right.
    expect(decideArchiveAction({ byteSize: 100 }, { byteSize: 999 })).toBe('REFUSE_MISMATCH');
  });

  it('a second run archives nothing new', async () => {
    const { deps: d, stored } = deps();
    const first = await archivePhoto(photo(), d);
    const second = await archivePhoto(photo(), d);

    expect(first.outcome).toBe('HEALTHY');
    expect(second.outcome).toBe('ALREADY_ARCHIVED');
    expect(stored.size).toBe(1);
  });

  it('flags a mismatched existing archive and does not replace it', async () => {
    const { deps: d, stored } = deps();
    stored.set(archiveObjectKey(photo()), 999);
    const put = jest.fn();
    const result = await archivePhoto(photo(), { ...d, vault: { ...d.vault, put } });

    expect(result.outcome).toBe('INTEGRITY_MISMATCH');
    expect(put).not.toHaveBeenCalled();
  });
});

describe('an outage is never reported as data loss', () => {
  it('reports SOURCE_NOT_FOUND only on a real 404', async () => {
    const { deps: d } = deps({
      download: async () => {
        throw new Error('HTTP 404');
      },
    });
    expect((await archivePhoto(photo(), d)).outcome).toBe('SOURCE_NOT_FOUND');
  });

  it('reports DOWNLOAD_FAILED, not SOURCE_NOT_FOUND, on a network fault', async () => {
    // Cloudinary being unreachable says nothing about whether the asset exists.
    const { deps: d } = deps({
      download: async () => {
        throw new Error('ECONNRESET');
      },
    });
    const r = await archivePhoto(photo(), d);

    expect(r.outcome).toBe('DOWNLOAD_FAILED');
    expect(r.outcome).not.toBe('SOURCE_NOT_FOUND');
  });

  it('reports ARCHIVE_VERIFY_FAILED, not a missing archive, when R2 head throws', async () => {
    const { deps: d } = deps();
    const r = await archivePhoto(photo(), {
      ...d,
      vault: {
        ...d.vault,
        head: async () => {
          throw new Error('R2 unreachable');
        },
      },
    });

    expect(r.outcome).toBe('ARCHIVE_VERIFY_FAILED');
  });

  it('reports ARCHIVE_UPLOAD_FAILED when the upload throws', async () => {
    const { deps: d } = deps();
    const r = await archivePhoto(photo(), {
      ...d,
      vault: {
        ...d.vault,
        put: async () => {
          throw new Error('AccessDenied');
        },
      },
    });

    expect(r.outcome).toBe('ARCHIVE_UPLOAD_FAILED');
  });

  it('reports HASH_MISMATCH when the bytes are not the captured bytes', async () => {
    const { deps: d } = deps({
      download: async (_u, dest) => writeFileSync(dest, Buffer.alloc(120_000, 9)),
    });
    const r = await archivePhoto(photo(), d);

    expect(r.outcome).toBe('HASH_MISMATCH');
    expect(r.archiveSha256).not.toBe(SHA);
  });

  it('fails verification when the archive lands at the wrong size', async () => {
    const { deps: d } = deps();
    let uploaded = false;
    const r = await archivePhoto(photo(), {
      ...d,
      vault: {
        ...d.vault,
        put: async () => {
          uploaded = true;
        },
        head: async (key) => (uploaded ? { key, byteSize: 5 } : null),
      },
    });

    expect(r.outcome).toBe('ARCHIVE_VERIFY_FAILED');
  });
});

describe('the signed URL never escapes the job', () => {
  it('is not present in the recorded result', async () => {
    const secret = 'https://res.cloudinary.com/signed?sig=SECRETVALUE&expires=1';
    const { deps: d } = deps({ signedUrlFor: () => secret });
    const r = await archivePhoto(photo(), d);

    // It is a temporary credential in URL form; persisting it anywhere would
    // outlive the scoping that makes it safe.
    expect(JSON.stringify(r)).not.toContain('SECRETVALUE');
    expect(JSON.stringify(r)).not.toContain('res.cloudinary.com');
  });

  it('is requested per photo rather than reused', async () => {
    const signedUrlFor = jest.fn(() => 'https://signed');
    const { deps: d } = deps({ signedUrlFor });
    await archivePhoto(photo({ id: 'p1' }), d);
    await archivePhoto(photo({ id: 'p2' }), d);

    expect(signedUrlFor).toHaveBeenCalledTimes(2);
  });
});

describe('the archive job never deletes', () => {
  it('has no path that removes anything', async () => {
    // The fake vault throws on remove; a healthy run must never reach it.
    const { deps: d } = deps();
    const r = await archivePhoto(photo(), d);

    expect(r.outcome).toBe('HEALTHY');
  });
});

describe('archive summary', () => {
  const result = (outcome: any) => ({
    photoId: 'p',
    outcome,
    archiveKey: 'k',
    byteSize: 1,
    archiveSha256: null,
    expectedSha256: SHA,
    archivedAt: null,
    detail: '',
  });

  it('needs no action when everything is archived', () => {
    const s = summariseArchive([result('HEALTHY'), result('ALREADY_ARCHIVED')]);
    expect(s.actionRequired).toBe(false);
  });

  it('needs action when a photograph is unprotected or unexplained', () => {
    for (const outcome of [
      'SOURCE_NOT_FOUND',
      'SOURCE_CHECK_FAILED',
      'DOWNLOAD_FAILED',
      'HASH_MISMATCH',
      'ARCHIVE_UPLOAD_FAILED',
      'ARCHIVE_VERIFY_FAILED',
      'INTEGRITY_MISMATCH',
    ]) {
      expect(summariseArchive([result(outcome)]).actionRequired).toBe(true);
    }
  });
});

describe('reconciliation keeps outages apart from loss', () => {
  const facts = (over: any = {}) => ({
    evidenceId: 'ev-1',
    photoAssetId: 'asset-1',
    primaryPresent: true,
    backupPresent: true,
    ...over,
  });

  it('CHECK_FAILED when Cloudinary could not be reached', () => {
    const a = assessPhoto(facts({ primaryPresent: null }));
    expect(a.health).toBe('CHECK_FAILED');
    expect(a.health).not.toBe('PRIMARY_MISSING_BACKUP_AVAILABLE');
    expect(a.detail).toMatch(/says nothing about whether/);
  });

  it('CHECK_FAILED when R2 could not be reached', () => {
    const a = assessPhoto(facts({ backupPresent: null }));
    expect(a.health).toBe('CHECK_FAILED');
    expect(a.health).not.toBe('BACKUP_MISSING');
  });

  it('INTEGRITY_MISMATCH when both exist but disagree on size', () => {
    const a = assessPhoto(facts({ expectedByteSize: 120_000, archiveByteSize: 99 }));
    expect(a.health).toBe('INTEGRITY_MISMATCH');
  });

  it('HEALTHY when both exist and agree', () => {
    expect(assessPhoto(facts({ expectedByteSize: 120_000, archiveByteSize: 120_000 })).health).toBe(
      'HEALTHY',
    );
  });

  it('PRIMARY_MISSING_BACKUP_AVAILABLE proves recovery is possible', () => {
    // Reported, never auto-restored: putting it back is a deliberate act.
    const a = assessPhoto(facts({ primaryPresent: false }));
    expect(a.health).toBe('PRIMARY_MISSING_BACKUP_AVAILABLE');
    expect(a.detail).toMatch(/can restore/);
  });

  it('BOTH_MISSING is reported on its own, never folded into BACKUP_MISSING', () => {
    const a = assessPhoto(facts({ primaryPresent: false, backupPresent: false }));
    expect(a.health).toBe('BOTH_MISSING');
  });

  it('counts every state in the summary', () => {
    const s = summarise([
      assessPhoto(facts()),
      assessPhoto(facts({ evidenceId: 'e2', primaryPresent: null })),
      assessPhoto(facts({ evidenceId: 'e3', expectedByteSize: 10, archiveByteSize: 20 })),
      assessPhoto(facts({ evidenceId: 'e4', primaryPresent: false, backupPresent: false })),
    ]);

    expect(s.healthy).toBe(1);
    expect(s.checkFailed).toBe(1);
    expect(s.integrityMismatch).toBe(1);
    expect(s.bothMissing).toBe(1);
    expect(s.actionRequired).toBe(true);
  });
});
