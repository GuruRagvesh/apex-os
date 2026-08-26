/**
 * Independent recovery copies of attendance punch photographs.
 *
 * Cloudinary stays the operational store; R2 holds a copy that survives losing
 * it. Reconciliation alone would only tell us a photograph is gone — it would
 * not give it back.
 *
 * TWO RULES SHAPE EVERYTHING HERE
 *
 * 1. This never touches the live punch. An employee punching in must succeed
 *    on capture → Cloudinary → PunchEvidence, and R2 being unreachable at
 *    10:00 must not stop them working. Archival runs afterwards, on its own
 *    schedule, and an unarchived photo is simply BACKUP_MISSING until the next
 *    run picks it up. Operational availability and disaster recovery do not
 *    share a failure domain.
 *
 * 2. An outage is never reported as data loss. "Cloudinary did not answer" and
 *    "the photograph is gone" look identical to a naive check and mean
 *    completely different things — one is a retry, the other is an incident.
 */

/** What happened to one photograph during archival. */
export type ArchiveOutcome =
  | 'HEALTHY'
  | 'ALREADY_ARCHIVED'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_CHECK_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'HASH_MISMATCH'
  | 'ARCHIVE_UPLOAD_FAILED'
  | 'ARCHIVE_VERIFY_FAILED'
  | 'INTEGRITY_MISMATCH';

export interface PhotoRecord {
  id: string;
  /** Cloudinary reference held by the evidence row. */
  objectKey: string;
  sha256: string;
  byteSize: number;
  receivedAt: Date;
}

/**
 * Where a photograph's archive copy lives.
 *
 * Deterministic, so re-running the job addresses the same object rather than
 * accumulating duplicates of an immutable photograph. Built only from the
 * photo id and its date: no employee name, no email, no coordinates. An object
 * key is metadata that travels in listings and logs, so it must carry nothing
 * that would matter if it were read.
 */
export function archiveObjectKey(photo: Pick<PhotoRecord, 'id' | 'receivedAt'>): string {
  const yyyy = photo.receivedAt.getUTCFullYear();
  const mm = String(photo.receivedAt.getUTCMonth() + 1).padStart(2, '0');
  return `attendance-photos/${yyyy}/${mm}/${photo.id}`;
}

export type ArchiveAction = 'UPLOAD' | 'SKIP_ALREADY_CORRECT' | 'REFUSE_MISMATCH';

/**
 * Whether to upload, skip, or stop.
 *
 * A punch photograph is immutable, so an archive object of a different size is
 * not a stale copy to refresh — it is two different things claiming to be the
 * same evidence. Overwriting would destroy whichever one was right, so the job
 * refuses and asks for a human.
 */
export function decideArchiveAction(
  expected: { byteSize: number },
  existing: { byteSize: number } | null,
): ArchiveAction {
  if (!existing) return 'UPLOAD';
  if (existing.byteSize === expected.byteSize) return 'SKIP_ALREADY_CORRECT';
  return 'REFUSE_MISMATCH';
}

export interface ArchiveResult {
  photoId: string;
  outcome: ArchiveOutcome;
  archiveKey: string | null;
  byteSize: number | null;
  archiveSha256: string | null;
  /** The hash recorded when the photo was captured, for comparison. */
  expectedSha256: string;
  archivedAt: string | null;
  detail: string;
}

export interface ArchiveSummary {
  total: number;
  archived: number;
  alreadyArchived: number;
  failed: number;
  integrityMismatch: number;
  sourceMissing: number;
  /** Failures that are outages rather than data problems. */
  checkFailed: number;
  actionRequired: boolean;
}

const FAILURE_OUTCOMES: ArchiveOutcome[] = [
  'DOWNLOAD_FAILED',
  'HASH_MISMATCH',
  'ARCHIVE_UPLOAD_FAILED',
  'ARCHIVE_VERIFY_FAILED',
];

export function summariseArchive(results: ArchiveResult[]): ArchiveSummary {
  const count = (o: ArchiveOutcome) => results.filter((r) => r.outcome === o).length;

  const summary: ArchiveSummary = {
    total: results.length,
    archived: count('HEALTHY'),
    alreadyArchived: count('ALREADY_ARCHIVED'),
    failed: results.filter((r) => FAILURE_OUTCOMES.includes(r.outcome)).length,
    integrityMismatch: count('INTEGRITY_MISMATCH'),
    sourceMissing: count('SOURCE_NOT_FOUND'),
    checkFailed: count('SOURCE_CHECK_FAILED'),
    actionRequired: false,
  };

  // Anything that is not "archived" or "already archived" leaves a photograph
  // unprotected or unexplained, and silently accumulating those is how a
  // recoverable situation becomes an unrecoverable one.
  summary.actionRequired =
    summary.failed + summary.integrityMismatch + summary.sourceMissing + summary.checkFailed > 0;
  return summary;
}
