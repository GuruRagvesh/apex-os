/**
 * The record of one backup run, and the rule that a backup is not a backup
 * until the remote copy has been verified.
 *
 * The failure this exists to prevent: a job that runs, exits 0, and reports
 * success while the archive is missing, truncated, or still on a disk that is
 * about to be wiped. `pg_dump` returning 0 says a file was written locally. It
 * says nothing about whether the vault holds a readable copy.
 *
 * So SUCCESS is reachable through exactly one path — remote verification — and
 * `lastSuccessfulAt` only ever moves on SUCCESS.
 */

export type BackupType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'PRE_MIGRATION';
export type BackupStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface BackupManifest {
  backupId: string;
  type: BackupType;
  environment: string;
  /** Masked. The real name is never written into the manifest. */
  databaseName: string;
  serverVersion: string | null;
  startedAt: string;
  completedAt: string | null;
  objectKey: string | null;
  byteSize: number | null;
  sha256: string | null;
  status: BackupStatus;
  failureReason: string | null;
  /** Set only once a remote HEAD confirmed the object and its size. */
  remoteVerifiedAt: string | null;
}

/** A dump smaller than this cannot be a real Apex OS database. */
export const MINIMUM_PLAUSIBLE_BYTES = 4096;

export function startManifest(input: {
  backupId: string;
  type: BackupType;
  environment: string;
  databaseName: string;
  startedAt: string;
}): BackupManifest {
  return {
    ...input,
    serverVersion: null,
    completedAt: null,
    objectKey: null,
    byteSize: null,
    sha256: null,
    status: 'RUNNING',
    failureReason: null,
    remoteVerifiedAt: null,
  };
}

export function markFailed(manifest: BackupManifest, reason: string, at: string): BackupManifest {
  return {
    ...manifest,
    status: 'FAILED',
    failureReason: reason,
    completedAt: at,
    // Explicitly cleared: a failed run must not leave behind a verification
    // timestamp that a later reader could mistake for proof.
    remoteVerifiedAt: null,
  };
}

export interface RemoteObject {
  key: string;
  byteSize: number;
}

/**
 * The only route to SUCCESS.
 *
 * Every check here answers "is there a usable copy in the vault", not "did the
 * command exit cleanly".
 */
export function verifyAndComplete(
  manifest: BackupManifest,
  local: { objectKey: string; byteSize: number; sha256: string },
  remote: RemoteObject | null,
  at: string,
): BackupManifest {
  const base = { ...manifest, objectKey: local.objectKey, byteSize: local.byteSize, sha256: local.sha256 };

  if (!remote) {
    return markFailed(base, 'Remote object not found after upload.', at);
  }
  if (remote.key !== local.objectKey) {
    return markFailed(base, 'Remote object key does not match the uploaded key.', at);
  }
  if (remote.byteSize !== local.byteSize) {
    return markFailed(
      base,
      `Remote size ${remote.byteSize} does not match local size ${local.byteSize}.`,
      at,
    );
  }
  if (local.byteSize < MINIMUM_PLAUSIBLE_BYTES) {
    // A dump this small means pg_dump produced almost nothing, which a size
    // comparison alone would happily call a match.
    return markFailed(
      base,
      `Backup is ${local.byteSize} bytes, below the ${MINIMUM_PLAUSIBLE_BYTES}-byte minimum.`,
      at,
    );
  }
  if (!local.sha256 || local.sha256.length !== 64) {
    return markFailed(base, 'Checksum missing or malformed.', at);
  }

  return { ...base, status: 'SUCCESS', failureReason: null, completedAt: at, remoteVerifiedAt: at };
}

export interface BackupState {
  lastSuccessfulAt: string | null;
  lastSuccessfulObjectKey: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: BackupStatus | null;
}

/**
 * Folds a finished run into the recorded state.
 *
 * A FAILED run updates the ATTEMPT fields and never the SUCCESS ones. Anything
 * else lets "last successful backup: today" appear on a day when the backup
 * did not work, which is worse than having no marker at all.
 */
export function applyRun(state: BackupState, manifest: BackupManifest): BackupState {
  const next: BackupState = {
    ...state,
    lastAttemptAt: manifest.completedAt ?? manifest.startedAt,
    lastAttemptStatus: manifest.status,
  };
  if (manifest.status !== 'SUCCESS') return next;
  return {
    ...next,
    lastSuccessfulAt: manifest.completedAt,
    lastSuccessfulObjectKey: manifest.objectKey,
  };
}

/**
 * Object key for a backup.
 *
 * Deterministic and sorted by date so the vault is browsable, and carrying no
 * credential or personal data. PRE_MIGRATION lives in its own prefix so the
 * daily retention sweep cannot reach it.
 */
export function objectKeyFor(type: BackupType, at: Date, databaseLabel: string): string {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(at.getUTCDate()).padStart(2, '0');
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mi = String(at.getUTCMinutes()).padStart(2, '0');
  const folder = type.toLowerCase().replace('_', '-');
  return `database/${folder}/${yyyy}/${mm}/apex-os-${databaseLabel}-${yyyy}-${mm}-${dd}-${hh}${mi}.dump`;
}
