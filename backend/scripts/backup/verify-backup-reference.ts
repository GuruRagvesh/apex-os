/**
 * Proof that a complete database backup exists before anything is erased.
 *
 * The operator passes the vault key of a backup MANIFEST written by
 * `npm run backup:database` (manifests/YYYY-MM-DD/<backupId>.json). A cron log,
 * a dashboard screenshot or a filename is not accepted. The proof is
 * cryptographic and independent of the backup job's own claims:
 *
 *   1. the manifest says SUCCESS, was remote-verified, is recent, and names
 *      the same environment, vault and (masked) database as this run;
 *   2. the dump it points at is DOWNLOADED, its size matches the manifest,
 *      and its SHA-256, computed here, matches the SHA-256 the manifest
 *      recorded at backup time;
 *   3. the local pg_restore is at least the major version of the server the
 *      dump was taken from (an older pg_restore cannot read a newer dump), and
 *      it can read the dump's full table of contents.
 *
 * Any missing field, mismatch or failure refuses execution.
 */

import { execFile } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { sha256File, type Vault } from '../../src/modules/platform/backup-vault/r2-vault';
import type { BackupManifest } from './backup-manifest';
import { mask } from './backup-identity';

export const DEFAULT_MAX_BACKUP_AGE_HOURS = 24;

export class BackupReferenceRefused extends Error {
  constructor(reason: string) {
    super(`Database backup reference refused: ${reason}`);
    this.name = 'BackupReferenceRefused';
  }
}

export interface ExpectedBackup {
  environment: string;
  database: string;
  bucket: string;
  now: Date;
  maxAgeHours: number;
}

/** Pure check of a parsed manifest. Separate so it is testable without a vault. */
export function checkBackupManifest(m: BackupManifest, expected: ExpectedBackup): void {
  if (!m || m.status !== 'SUCCESS') throw new BackupReferenceRefused('the backup did not succeed.');
  if (!m.remoteVerifiedAt) throw new BackupReferenceRefused('the backup was never verified in the vault.');
  if (m.environment !== expected.environment) {
    throw new BackupReferenceRefused(`the backup is of ${m.environment}, not ${expected.environment}.`);
  }
  if (!m.vaultBucket) {
    throw new BackupReferenceRefused('the manifest does not record which vault it was written to.');
  }
  if (m.vaultBucket !== expected.bucket) {
    throw new BackupReferenceRefused('the backup was written to a different vault.');
  }
  if (m.databaseName !== mask(expected.database)) {
    throw new BackupReferenceRefused('the backup is of a different database.');
  }
  const ageHours = (expected.now.getTime() - Date.parse(m.remoteVerifiedAt)) / 3_600_000;
  if (!(ageHours >= 0) || ageHours > expected.maxAgeHours) {
    throw new BackupReferenceRefused(`the backup is ${ageHours.toFixed(1)} h old; the limit is ${expected.maxAgeHours} h.`);
  }
  if (!m.objectKey) throw new BackupReferenceRefused('the manifest names no dump object.');
  if (!m.byteSize || m.byteSize <= 0) throw new BackupReferenceRefused('the manifest records no dump size.');
  if (!m.sha256 || !/^[0-9a-f]{64}$/.test(m.sha256)) {
    throw new BackupReferenceRefused('the manifest records no valid SHA-256 for the dump.');
  }
}

export interface BackupVerifyDeps {
  vault: Vault;
  sha256File: (path: string) => Promise<string>;
  /** Structural check, e.g. `pg_restore --list`. Must throw when unreadable. */
  verifyDump: (path: string) => Promise<void>;
  /** Major version of the local pg_restore that verifyDump runs. */
  restoreClientMajor: () => Promise<number>;
}

export interface VerifiedBackup {
  manifest: BackupManifest;
  computedSha256: string;
}

export async function verifyDatabaseBackup(
  deps: BackupVerifyDeps,
  manifestKey: string,
  expected: Omit<ExpectedBackup, 'maxAgeHours'> & { maxAgeHours?: number },
): Promise<VerifiedBackup> {
  if (!/^manifests\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9-]+\.json$/.test(manifestKey)) {
    throw new BackupReferenceRefused('--database-backup-reference must be a backup manifest key (manifests/YYYY-MM-DD/<id>.json).');
  }
  const dir = mkdtempSync(join(tmpdir(), 'apex-backup-reference-'));
  try {
    let manifest: BackupManifest;
    try {
      const path = join(dir, 'manifest.json');
      await deps.vault.getToFile(manifestKey, path);
      manifest = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new BackupReferenceRefused('the manifest could not be read from the vault.');
    }

    checkBackupManifest(manifest, { ...expected, maxAgeHours: expected.maxAgeHours ?? DEFAULT_MAX_BACKUP_AGE_HOURS });

    // The pg_restore that reads the dump must be at least the server's major
    // version; an older client cannot read a newer archive format.
    const serverMajor = Number(/(\d+)/.exec(String(manifest.serverVersion ?? ''))?.[1] ?? Number.NaN);
    if (!Number.isFinite(serverMajor)) {
      throw new BackupReferenceRefused('the manifest does not record the PostgreSQL server version.');
    }
    let clientMajor: number;
    try {
      clientMajor = await deps.restoreClientMajor();
    } catch {
      clientMajor = Number.NaN;
    }
    if (!Number.isFinite(clientMajor)) throw new BackupReferenceRefused('the local pg_restore version could not be determined.');
    if (clientMajor < serverMajor) {
      throw new BackupReferenceRefused(`pg_restore ${clientMajor} cannot verify a dump of PostgreSQL ${serverMajor}; install pg_restore ${serverMajor} or newer.`);
    }

    const head = await deps.vault.head(manifest.objectKey!);
    if (!head || head.byteSize !== manifest.byteSize) {
      throw new BackupReferenceRefused('the dump the manifest points at is missing or the wrong size.');
    }

    // Download the dump itself. The hash the manifest recorded was computed
    // by the backup job; this one is computed here, from the vault's bytes.
    const dumpPath = join(dir, 'backup.dump');
    try {
      await deps.vault.getToFile(manifest.objectKey!, dumpPath);
    } catch {
      throw new BackupReferenceRefused('the dump could not be downloaded from the vault.');
    }
    if (statSync(dumpPath).size !== manifest.byteSize) {
      throw new BackupReferenceRefused('the downloaded dump is incomplete (size differs from the manifest).');
    }
    const computedSha256 = await deps.sha256File(dumpPath);
    if (computedSha256 !== manifest.sha256) {
      throw new BackupReferenceRefused('the dump\'s SHA-256 does not match the manifest.');
    }
    try {
      await deps.verifyDump(dumpPath);
    } catch (err: any) {
      throw new BackupReferenceRefused(`pg_restore could not read the dump (${String(err?.message ?? err).slice(0, 160)}).`);
    }
    return { manifest, computedSha256 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Real dependencies
// ─────────────────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);

/** pg_restore --list reads the dump's whole table of contents without touching a database. */
export async function pgRestoreList(dumpPath: string): Promise<void> {
  const { stdout } = await execFileAsync('pg_restore', ['--list', dumpPath], { maxBuffer: 64 * 1024 * 1024 });
  if (!/TABLE DATA/.test(stdout)) throw new Error('pg_restore lists no table data; the dump is not a usable backup.');
}

/** "pg_restore (PostgreSQL) 18.4" -> 18. No connection involved. */
export async function pgRestoreClientMajor(): Promise<number> {
  const { stdout } = await execFileAsync('pg_restore', ['--version']);
  const m = /(\d+)\.\d+/.exec(stdout);
  return m ? Number(m[1]) : Number.NaN;
}

/** The real verification tools: local SHA-256, pg_restore --list and its version. */
export function backupVerifyTools(): Omit<BackupVerifyDeps, 'vault'> {
  return { sha256File, verifyDump: pgRestoreList, restoreClientMajor: pgRestoreClientMajor };
}
