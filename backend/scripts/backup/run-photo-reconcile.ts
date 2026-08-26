/**
 * Photo reconciliation.
 *
 *   npm run backup:reconcile-photos
 *   npm run backup:reconcile-photos -- --limit=2000
 *
 * Asks one question of every punch photograph: is it actually recoverable.
 * Three sources are compared — what the database claims, what Cloudinary
 * holds, what R2 holds — and the answer is reported. Nothing is repaired,
 * deleted, overwritten or restored: PRIMARY_MISSING_BACKUP_AVAILABLE proves
 * recovery is possible, and performing it stays a deliberate act.
 *
 * Cloudinary is asked through the Admin API, which is the right tool for
 * "does this asset exist" — that is a metadata question, not a delivery one,
 * so no signed URL is minted here at all.
 */

import { v2 as cloudinary } from 'cloudinary';
import { PrismaClient } from '@prisma/client';
import { assessPhoto, summarise, type PhotoAssessment, type ReconciliationSummary } from './photo-reconciliation';
import { archiveObjectKey } from './photo-archive';
import { createR2Vault, readR2Config, type Vault } from './r2-vault';

export interface ReconcileRow {
  evidenceId: string;
  photoId: string | null;
  /** Cloudinary reference recorded at capture. */
  objectKey: string | null;
  expectedByteSize: number | null;
  receivedAt: Date | null;
}

export interface ReconcileDeps {
  vault: Vault;
  /**
   * Whether the operational asset exists.
   * Returns null when the question could not be answered — an outage is not
   * an absent photograph.
   */
  primaryExists: (objectKey: string) => Promise<boolean | null>;
}

export async function reconcilePhotos(
  rows: ReconcileRow[],
  deps: ReconcileDeps,
): Promise<PhotoAssessment[]> {
  const out: PhotoAssessment[] = [];

  for (const row of rows) {
    if (!row.photoId || !row.objectKey || !row.receivedAt) {
      out.push(assessPhoto({ evidenceId: row.evidenceId, photoAssetId: null, primaryPresent: null, backupPresent: null }));
      continue;
    }

    const primaryPresent = await deps.primaryExists(row.objectKey);

    let backupPresent: boolean | null;
    let archiveByteSize: number | null = null;
    try {
      const head = await deps.vault.head(
        archiveObjectKey({ id: row.photoId, receivedAt: row.receivedAt }),
      );
      backupPresent = head !== null;
      archiveByteSize = head?.byteSize ?? null;
    } catch {
      // R2 being unreachable says nothing about whether the archive exists.
      backupPresent = null;
    }

    out.push(
      assessPhoto({
        evidenceId: row.evidenceId,
        photoAssetId: row.photoId,
        primaryPresent,
        backupPresent,
        expectedByteSize: row.expectedByteSize,
        archiveByteSize,
      }),
    );
  }
  return out;
}

/**
 * The process exit code for a reconciliation run.
 *
 * Two modes, because the same finding means different things at different
 * points in the system's life.
 *
 * BACKFILL (default) — BACKUP_MISSING is expected: every photograph captured
 * before archiving existed is in that state, and failing on it would make the
 * first honest run look broken. Only a photograph that cannot be produced, two
 * copies disagreeing, or a store that could not be reached are critical. The
 * last of those counts because an unanswered question must not pass as a clean
 * bill of health.
 *
 * STRICT — for scheduled reconciliation once everything is archived. By then a
 * photograph without an independent copy is not history, it is new evidence
 * that was never protected, and silence about it is exactly the drift this
 * system exists to catch.
 */
export function exitCodeForReconciliation(
  summary: ReconciliationSummary,
  strict = false,
): number {
  const critical = summary.bothMissing + summary.integrityMismatch + summary.checkFailed;
  if (critical > 0) return 1;
  if (strict && summary.backupMissing + summary.primaryMissing > 0) return 1;
  return 0;
}

export function describeRun(summary: ReconciliationSummary, strict = false): string {
  const critical = summary.bothMissing + summary.integrityMismatch + summary.checkFailed;
  if (critical > 0) return 'CRITICAL';
  if (summary.backupMissing > 0 || summary.primaryMissing > 0) {
    // Same finding, different severity: unprotected evidence is tolerable
    // while backfilling and an incident once steady state is expected.
    return strict ? 'UNPROTECTED EVIDENCE' : 'ACTION REQUIRED';
  }
  return 'HEALTHY';
}

if (require.main === module) {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = Number(limitArg?.split('=')[1] ?? 2000);
  const strict = process.argv.includes('--strict');

  (async () => {
    console.log('── Apex OS attendance photo reconciliation ────────────────────');
    console.log(`  mode            : ${strict ? 'STRICT (steady state)' : 'BACKFILL'}`);

    for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      if (!process.env[key]) throw new Error(`${key} is not set; the primary store cannot be checked.`);
    }
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const vault = createR2Vault(readR2Config(process.env));
    const prisma = new PrismaClient();

    try {
      const evidence = await prisma.attendancePunchEvidence.findMany({
        where: { photoAssetId: { not: null } },
        orderBy: { serverOccurredAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 10_000),
        select: {
          id: true,
          photoAssetId: true,
          photoAsset: { select: { id: true, objectKey: true, byteSize: true, receivedAt: true } },
        },
      });

      const rows: ReconcileRow[] = evidence.map((e: any) => ({
        evidenceId: e.id,
        photoId: e.photoAsset?.id ?? null,
        objectKey: e.photoAsset?.objectKey ?? null,
        expectedByteSize: e.photoAsset?.byteSize ?? null,
        receivedAt: e.photoAsset?.receivedAt ?? null,
      }));

      console.log(`  evidence checked: ${rows.length}`);

      const assessments = await reconcilePhotos(rows, {
        vault,
        primaryExists: async (objectKey) => {
          const [, , resourceType, publicId] = objectKey.split(':');
          if (!publicId) return null;
          try {
            // Metadata question, answered with the Admin API. No signed URL,
            // no bytes, no delivery.
            await cloudinary.api.resource(decodeURIComponent(publicId), {
              resource_type: resourceType || 'image',
              type: 'authenticated',
            });
            return true;
          } catch (err: any) {
            const status = err?.error?.http_code ?? err?.http_code;
            if (status === 404) return false;
            // Anything else is an outage, not an absent asset.
            return null;
          }
        },
      });

      const summary = summarise(assessments);
      console.log(`  HEALTHY                          ${summary.healthy}`);
      console.log(`  BACKUP_MISSING                   ${summary.backupMissing}`);
      console.log(`  PRIMARY_MISSING_BACKUP_AVAILABLE ${summary.primaryMissing}`);
      console.log(`  BOTH_MISSING                     ${summary.bothMissing}`);
      console.log(`  INTEGRITY_MISMATCH               ${summary.integrityMismatch}`);
      console.log(`  CHECK_FAILED                     ${summary.checkFailed}`);
      console.log(`  no photo claimed                 ${summary.noPhoto}`);

      for (const a of assessments) {
        if (a.health === 'HEALTHY' || a.health === 'NO_PHOTO_CLAIMED') continue;
        // Evidence id and verdict only: no employee identity, no coordinates,
        // no object keys, no URLs.
        console.log(`    ${a.health.padEnd(32)} ${a.evidenceId}`);
      }

      const verdict = describeRun(summary, strict);
      console.log(`\nRECONCILIATION: ${verdict}`);

      if (verdict === 'ACTION REQUIRED') {
        console.log('Run backup:archive-photos, then reconcile again.\n');
      } else if (verdict === 'UNPROTECTED EVIDENCE') {
        console.error('Attendance evidence exists with no independent copy. In steady');
        console.error('state that is new evidence that was never archived.\n');
      } else if (verdict === 'CRITICAL') {
        console.error('A photograph cannot be produced, two copies disagree, or a store');
        console.error('could not be reached. Nothing has been changed; investigate first.\n');
      } else {
        console.log('Every photograph has a verified independent copy.\n');
      }

      process.exit(exitCodeForReconciliation(summary, strict));
    } finally {
      await prisma.$disconnect();
    }
  })().catch((err) => {
    console.error('\nRECONCILIATION ABORTED:', err?.message ?? err);
    process.exit(1);
  });
}
