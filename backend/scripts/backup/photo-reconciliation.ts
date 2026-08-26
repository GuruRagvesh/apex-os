/**
 * Whether a punch photograph is actually recoverable.
 *
 * A reconciliation check on its own tells you the disaster happened; it does
 * not give the photograph back. So Apex OS keeps two copies — Cloudinary as
 * the operational store, R2 as the independent archive — and this classifies
 * what is actually present.
 *
 * The state that matters is BOTH_MISSING: an evidence row that claims a
 * photograph nobody can produce. That is the one an employee could be asked to
 * account for in a dispute, so it must never be inferred from a partial check
 * or quietly folded in with "backup missing".
 *
 * Nothing here deletes or repairs. It reports, and a human decides.
 */

export type PhotoHealth =
  | 'HEALTHY'
  | 'PRIMARY_MISSING_BACKUP_AVAILABLE'
  | 'BACKUP_MISSING'
  | 'BOTH_MISSING'
  | 'NO_PHOTO_CLAIMED';

export interface PhotoFacts {
  evidenceId: string;
  /** What the database claims exists. */
  photoAssetId: string | null;
  /** Whether the operational asset resolved. Null when the check could not run. */
  primaryPresent: boolean | null;
  /** Whether the archive copy resolved. Null when the check could not run. */
  backupPresent: boolean | null;
}

export interface PhotoAssessment {
  evidenceId: string;
  health: PhotoHealth;
  /** True when a check could not be completed, so the verdict is provisional. */
  indeterminate: boolean;
  detail: string;
}

export function assessPhoto(facts: PhotoFacts): PhotoAssessment {
  const base = { evidenceId: facts.evidenceId };

  if (!facts.photoAssetId) {
    // The row never claimed a photograph. Absence here is not a loss, and
    // reporting it as one would bury the real failures in noise.
    return {
      ...base,
      health: 'NO_PHOTO_CLAIMED',
      indeterminate: false,
      detail: 'No photo was recorded for this punch.',
    };
  }

  // An unfinished check is never reported as a clean state. Saying HEALTHY
  // because the archive lookup errored is exactly the false assurance this
  // system exists to remove.
  if (facts.primaryPresent === null || facts.backupPresent === null) {
    return {
      ...base,
      health: facts.primaryPresent === false ? 'PRIMARY_MISSING_BACKUP_AVAILABLE' : 'BACKUP_MISSING',
      indeterminate: true,
      detail: 'One of the storage checks could not be completed; verdict is provisional.',
    };
  }

  if (facts.primaryPresent && facts.backupPresent) {
    return { ...base, health: 'HEALTHY', indeterminate: false, detail: 'Both copies present.' };
  }
  if (!facts.primaryPresent && facts.backupPresent) {
    return {
      ...base,
      health: 'PRIMARY_MISSING_BACKUP_AVAILABLE',
      indeterminate: false,
      detail: 'Operational copy is gone; the archive copy can restore it.',
    };
  }
  if (facts.primaryPresent && !facts.backupPresent) {
    return {
      ...base,
      health: 'BACKUP_MISSING',
      indeterminate: false,
      detail: 'Photo is served but unprotected; it needs archiving.',
    };
  }
  return {
    ...base,
    health: 'BOTH_MISSING',
    indeterminate: false,
    detail: 'The record claims a photograph that no store can produce.',
  };
}

export interface ReconciliationSummary {
  total: number;
  healthy: number;
  primaryMissing: number;
  backupMissing: number;
  bothMissing: number;
  noPhoto: number;
  indeterminate: number;
  /** True when anything needs a human. */
  actionRequired: boolean;
}

export function summarise(assessments: PhotoAssessment[]): ReconciliationSummary {
  const count = (h: PhotoHealth) => assessments.filter((a) => a.health === h).length;
  const bothMissing = count('BOTH_MISSING');
  const backupMissing = count('BACKUP_MISSING');
  const primaryMissing = count('PRIMARY_MISSING_BACKUP_AVAILABLE');
  const indeterminate = assessments.filter((a) => a.indeterminate).length;

  return {
    total: assessments.length,
    healthy: count('HEALTHY'),
    primaryMissing,
    backupMissing,
    bothMissing,
    noPhoto: count('NO_PHOTO_CLAIMED'),
    indeterminate,
    // Unprotected evidence counts as needing action: silently accumulating it
    // is how a recoverable situation becomes an unrecoverable one.
    actionRequired: bothMissing + backupMissing + primaryMissing + indeterminate > 0,
  };
}
