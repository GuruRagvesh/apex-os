/**
 * Independent archive of attendance punch photographs.
 *
 *   npm run backup:archive-photos
 *   npm run backup:archive-photos -- --limit=500
 *
 * Runs on its own schedule, entirely separate from punching. If R2 is
 * unreachable at 10:00 an employee still punches in normally; their photograph
 * sits BACKUP_MISSING until this job next runs. Operational attendance and
 * disaster recovery must not share a failure domain.
 *
 * Punch photos are stored in Cloudinary as `type: authenticated`, whose
 * supported access path is a signed URL. The job mints a short-lived one
 * server-side, streams the original through, and discards it. That URL is
 * never returned to a client, never written to the database, never put in a
 * manifest, and never logged.
 *
 * Nothing here deletes or rewrites anything.
 */

import { createWriteStream } from 'fs';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaClient } from '@prisma/client';
import {
  archiveObjectKey,
  decideArchiveAction,
  summariseArchive,
  type ArchiveResult,
  type PhotoRecord,
} from './photo-archive';
import { createR2Vault, readR2Config, sha256File, type Vault } from './r2-vault';
import { assertPhotoTarget, mask } from './backup-identity';

export interface ArchiveDeps {
  vault: Vault;
  /** Mints a short-lived signed URL for an authenticated Cloudinary asset. */
  signedUrlFor: (objectKey: string) => string;
  /** Streams the asset to a local path. Resolves the byte count written. */
  download: (url: string, destination: string) => Promise<void>;
  now: () => Date;
}

/**
 * Archives one photograph.
 *
 * Returns an outcome rather than throwing, because one unreachable asset must
 * not abandon the rest of the run — and because the outcome itself is the
 * thing worth recording.
 */
export async function archivePhoto(
  photo: PhotoRecord,
  deps: ArchiveDeps,
): Promise<ArchiveResult> {
  const archiveKey = archiveObjectKey(photo);
  const base = {
    photoId: photo.id,
    archiveKey,
    byteSize: null as number | null,
    archiveSha256: null as string | null,
    expectedSha256: photo.sha256,
    archivedAt: null as string | null,
  };

  // Already archived? Verify rather than assume, and never overwrite.
  let existing: { key: string; byteSize: number } | null;
  try {
    existing = await deps.vault.head(archiveKey);
  } catch (err: any) {
    return {
      ...base,
      outcome: 'ARCHIVE_VERIFY_FAILED',
      detail: `Archive could not be checked: ${err?.message ?? err}`,
    };
  }

  const action = decideArchiveAction({ byteSize: photo.byteSize }, existing);
  if (action === 'SKIP_ALREADY_CORRECT') {
    return {
      ...base,
      outcome: 'ALREADY_ARCHIVED',
      byteSize: existing!.byteSize,
      detail: 'Archive copy already present and the right size.',
    };
  }
  if (action === 'REFUSE_MISMATCH') {
    // A punch photograph is immutable, so a different size is not a stale copy
    // to refresh -- it is two things claiming to be the same evidence.
    return {
      ...base,
      outcome: 'INTEGRITY_MISMATCH',
      byteSize: existing!.byteSize,
      detail:
        `Existing archive is ${existing!.byteSize} bytes, the record says ${photo.byteSize}. ` +
        'Refusing to overwrite immutable evidence.',
    };
  }

  const dir = mkdtempSync(join(tmpdir(), 'apex-photo-'));
  const localPath = join(dir, 'asset');

  try {
    const url = deps.signedUrlFor(photo.objectKey);
    try {
      await deps.download(url, localPath);
    } catch (err: any) {
      // 404 means the asset is gone. Anything else is an outage, and calling
      // an outage "missing" would raise a false incident.
      const message = String(err?.message ?? err);
      const notFound = /\b404\b|not found/i.test(message);
      return {
        ...base,
        outcome: notFound ? 'SOURCE_NOT_FOUND' : 'DOWNLOAD_FAILED',
        detail: notFound
          ? 'Cloudinary reports the asset does not exist.'
          : `Download failed: ${message}`,
      };
    }

    const byteSize = statSync(localPath).size;
    const archiveSha256 = await sha256File(localPath);

    if (photo.sha256 && archiveSha256 !== photo.sha256) {
      // The bytes are not the bytes that were captured. Archiving them would
      // preserve the wrong thing while reporting success.
      return {
        ...base,
        outcome: 'HASH_MISMATCH',
        byteSize,
        archiveSha256,
        detail: 'Downloaded asset does not match the hash recorded at capture.',
      };
    }

    try {
      await deps.vault.put(archiveKey, localPath, 'application/octet-stream');
    } catch (err: any) {
      return {
        ...base,
        outcome: 'ARCHIVE_UPLOAD_FAILED',
        byteSize,
        archiveSha256,
        detail: `Upload failed: ${err?.message ?? err}`,
      };
    }

    const remote = await deps.vault.head(archiveKey);
    if (!remote || remote.byteSize !== byteSize) {
      return {
        ...base,
        outcome: 'ARCHIVE_VERIFY_FAILED',
        byteSize,
        archiveSha256,
        detail: remote
          ? `Archive is ${remote.byteSize} bytes, expected ${byteSize}.`
          : 'Archive object not found after upload.',
      };
    }

    return {
      ...base,
      outcome: 'HEALTHY',
      byteSize,
      archiveSha256,
      archivedAt: deps.now().toISOString(),
      detail: 'Archived and verified.',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function runPhotoArchive(
  photos: PhotoRecord[],
  deps: ArchiveDeps,
): Promise<ArchiveResult[]> {
  const results: ArchiveResult[] = [];
  for (const photo of photos) {
    results.push(await archivePhoto(photo, deps));
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Short-lived signed URL for an authenticated asset. Never leaves this job. */
export function makeSignedUrlFactory(ttlSeconds = 120) {
  return (objectKey: string): string => {
    const [, , resourceType, publicId, format] = objectKey.split(':');
    if (!publicId) throw new Error('Stored photo reference is invalid');
    return cloudinary.url(decodeURIComponent(publicId), {
      resource_type: resourceType || 'image',
      type: 'authenticated',
      secure: true,
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
      format: format ? decodeURIComponent(format) : undefined,
    });
  };
}

async function streamDownload(url: string, destination: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error('Response had no body');
  // Streamed so a large asset never sits in memory.
  await pipeline(res.body as any, createWriteStream(destination));
}

if (require.main === module) {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = Number(limitArg?.split('=')[1] ?? 500);

  (async () => {
    console.log('── Apex OS attendance photo archive ───────────────────────────');

    for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      if (!process.env[key]) throw new Error(`${key} is not set; cannot read the primary store.`);
    }
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    // Which database and vault this is allowed to touch. Refuses before any
    // connection is opened, and prints nothing that identifies a credential.
    const target = assertPhotoTarget(process.env);
    console.log(`  environment     : ${target.environment}`);
    console.log(`  database host   : ${mask(target.host)}`);
    console.log(`  database        : ${target.database}`);
    console.log(`  vault bucket    : ${target.bucket}`);

    const vault = createR2Vault(readR2Config(process.env));
    const prisma = new PrismaClient();

    try {
      const photos = await prisma.attendancePunchPhoto.findMany({
        orderBy: { receivedAt: 'asc' },
        take: Math.min(Math.max(limit, 1), 5000),
        select: { id: true, objectKey: true, sha256: true, byteSize: true, receivedAt: true },
      });

      console.log(`  candidates      : ${photos.length}`);
      const results = await runPhotoArchive(photos, {
        vault,
        signedUrlFor: makeSignedUrlFactory(),
        download: streamDownload,
        now: () => new Date(),
      });

      const summary = summariseArchive(results);
      console.log(`  archived        : ${summary.archived}`);
      console.log(`  already archived: ${summary.alreadyArchived}`);
      console.log(`  source missing  : ${summary.sourceMissing}`);
      console.log(`  integrity issues: ${summary.integrityMismatch}`);
      console.log(`  check failed    : ${summary.checkFailed}`);
      console.log(`  failed          : ${summary.failed}`);

      for (const r of results.filter((x) => x.outcome !== 'HEALTHY' && x.outcome !== 'ALREADY_ARCHIVED')) {
        // Photo id and outcome only. No signed URL, no employee identity.
        console.log(`    ${r.outcome.padEnd(24)} ${r.photoId}  ${r.detail}`);
      }

      if (summary.actionRequired) {
        console.error('\nPHOTO ARCHIVE COMPLETED WITH ISSUES.\n');
        process.exit(1);
      }
      console.log('\nPHOTO ARCHIVE COMPLETE. Every photograph has a verified copy.\n');
    } finally {
      await prisma.$disconnect();
    }
  })().catch((err) => {
    console.error('\nPHOTO ARCHIVE ABORTED:', err?.message ?? err);
    process.exit(1);
  });
}
