/**
 * Permanent-deletion storage readiness. Backend-only and READ-ONLY.
 *
 *   npm run admin:storage:readiness -- --environment=staging
 *
 * Reports whether the two storage systems a permanent deletion depends on are
 * configured and usable. It never selects, archives or deletes a user, never
 * connects to the application database, never creates a folder, and never
 * writes an object.
 *
 *   environment    APP_ENV, --environment and GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT agree
 *   r2-config      R2 credentials present; database identity and the exact backup
 *                  vault bucket accepted by assertBackupTarget (string checks only)
 *   r2-backup      the newest backup for this environment passes the full
 *                  verification a deletion relies on (verifyDatabaseBackup): SUCCESS
 *                  manifest under 24 hours old for this environment, database and
 *                  exact vault; dump present at the recorded size, DOWNLOADED and
 *                  its SHA-256 recomputed; pg_restore at least the server's major
 *                  version reads it with pg_restore --list
 *   drive-config   GOOGLE_DRIVE_* configuration present for this environment
 *   drive-account  the refresh token works and belongs to GOOGLE_DRIVE_ARCHIVE_ACCOUNT
 *   drive-private  Apex OS Secure Archives and its <environment> folder are
 *                  owner-only, in My Drive, and correctly labelled
 *
 * There is no lighter backup check: a manifest and a matching size do not prove
 * the bytes, so nothing short of verifyDatabaseBackup counts as ready. Reading
 * is all it does -- the dump is downloaded to a temporary directory that is
 * removed afterwards, and no R2 object is written or deleted.
 *
 * Output names checks, environments, masked database names and bucket names
 * only. No credential, token or URL is printed.
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createR2Vault, readR2Config, type Vault } from '../../src/modules/platform/backup-vault/r2-vault';
import { assertBackupTarget, type BackupTarget } from '../backup/backup-identity';
import type { BackupManifest } from '../backup/backup-manifest';
import { backupVerifyTools, verifyDatabaseBackup, type BackupVerifyDeps } from '../backup/verify-backup-reference';
import { createDriveVault, isArchiveAccount, readDriveConfig, type ArchiveVault, type DriveConfig } from '../drive-archive/drive-vault';
import { verifyFolderChain } from '../drive-archive/folder-privacy';

export interface ReadinessCheck {
  check: 'environment' | 'r2-config' | 'r2-backup' | 'drive-config' | 'drive-account' | 'drive-private';
  ok: boolean;
  detail: string;
}

export interface ReadinessDeps {
  env: NodeJS.ProcessEnv;
  environment: string;
  now: Date;
  makeR2Vault: (env: NodeJS.ProcessEnv) => Vault;
  /** SHA-256, pg_restore --list and pg_restore version: the same tools a deletion uses. */
  backupTools: Omit<BackupVerifyDeps, 'vault'>;
  makeDriveVault: (config: DriveConfig) => ArchiveVault;
}

const msg = (err: any) => String(err?.message ?? err).split('\n')[0].slice(0, 240);

async function readManifest(vault: Vault, key: string): Promise<BackupManifest | null> {
  const dir = mkdtempSync(join(tmpdir(), 'apex-readiness-'));
  try {
    const p = join(dir, 'm.json');
    await vault.getToFile(key, p);
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The newest backup manifest for this environment written in the last two UTC days, or null. */
export async function latestBackupManifest(vault: Vault, environment: string, now: Date): Promise<{ key: string; manifest: BackupManifest } | null> {
  const days = [0, 1].map((d) => new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10));
  let best: { key: string; manifest: BackupManifest } | null = null;
  for (const day of days) {
    for (const obj of await vault.list(`manifests/${day}/`)) {
      if (!obj.key.endsWith('.json')) continue;
      const m = await readManifest(vault, obj.key);
      if (!m || m.environment !== environment || m.status !== 'SUCCESS' || !m.remoteVerifiedAt) continue;
      if (!best || Date.parse(m.remoteVerifiedAt) > Date.parse(best.manifest.remoteVerifiedAt!)) best = { key: obj.key, manifest: m };
    }
  }
  return best;
}

export async function checkReadiness(deps: ReadinessDeps): Promise<ReadinessCheck[]> {
  const out: ReadinessCheck[] = [];
  const env = deps.env;
  const wanted = (deps.environment ?? '').trim().toLowerCase();

  // Environment
  const appEnv = (env.APP_ENV ?? '').trim().toLowerCase();
  const driveEnv = (env.GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT ?? '').trim().toLowerCase();
  if ((wanted !== 'staging' && wanted !== 'production') || appEnv !== wanted || driveEnv !== wanted) {
    out.push({ check: 'environment', ok: false, detail: `--environment "${wanted || '(unset)'}", APP_ENV "${appEnv || '(unset)'}" and GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT "${driveEnv || '(unset)'}" must all be the same, staging or production.` });
    return out;
  }
  out.push({ check: 'environment', ok: true, detail: `All three name ${wanted}.` });

  // R2: configuration, then the latest backup.
  let target: BackupTarget | null = null;
  let r2: Vault | null = null;
  try {
    readR2Config(env);
    target = assertBackupTarget(env);
    r2 = deps.makeR2Vault(env);
    out.push({ check: 'r2-config', ok: true, detail: `Backups for ${target.environment} go to ${target.bucket}.` });
  } catch (err) {
    out.push({ check: 'r2-config', ok: false, detail: msg(err) });
  }
  if (target && r2) {
    try {
      const latest = await latestBackupManifest(r2, target.environment, deps.now);
      if (!latest) throw new Error(`no successful ${target.environment} backup manifest in the last two days.`);
      const verified = await verifyDatabaseBackup({ ...deps.backupTools, vault: r2 }, latest.key, {
        environment: target.environment,
        database: target.database,
        bucket: target.bucket,
        now: deps.now,
      });
      out.push({
        check: 'r2-backup',
        ok: true,
        detail: `Backup ${latest.key} fully verified: downloaded, SHA-256 matches, pg_restore --list reads it (backed up ${verified.manifest.remoteVerifiedAt}).`,
      });
    } catch (err) {
      out.push({ check: 'r2-backup', ok: false, detail: msg(err) });
    }
  } else {
    out.push({ check: 'r2-backup', ok: false, detail: 'Not checked: R2 configuration is not usable.' });
  }

  // Google Drive: configuration, account, folder privacy.
  let config: DriveConfig | null = null;
  try {
    config = readDriveConfig(env, wanted);
    out.push({ check: 'drive-config', ok: true, detail: `Archive vault configured for ${config.environment}.` });
  } catch (err) {
    out.push({ check: 'drive-config', ok: false, detail: msg(err) });
  }
  if (!config) {
    out.push({ check: 'drive-account', ok: false, detail: 'Not checked: Drive configuration is incomplete.' });
    out.push({ check: 'drive-private', ok: false, detail: 'Not checked: Drive configuration is incomplete.' });
    return out;
  }
  const drive = deps.makeDriveVault(config);
  try {
    const who = await drive.account();
    if (!isArchiveAccount(who.email, config.account)) throw new Error('the authorized Google account is not GOOGLE_DRIVE_ARCHIVE_ACCOUNT.');
    out.push({ check: 'drive-account', ok: true, detail: `Authorized as ${config.account}.` });
  } catch (err) {
    out.push({ check: 'drive-account', ok: false, detail: msg(err) });
    out.push({ check: 'drive-private', ok: false, detail: 'Not checked: Drive authorization failed.' });
    return out;
  }
  try {
    await verifyFolderChain(drive, wanted, []);
    out.push({ check: 'drive-private', ok: true, detail: `Apex OS Secure Archives/${wanted} is owner-only, in My Drive, and correctly labelled.` });
  } catch (err) {
    out.push({ check: 'drive-private', ok: false, detail: msg(err) });
  }
  return out;
}

async function main(): Promise<number> {
  const environment = process.argv.slice(2).find((a) => a.startsWith('--environment='))?.split('=')[1] ?? '';
  console.log('── Apex OS permanent-deletion storage readiness (read-only) ───');
  const checks = await checkReadiness({
    env: process.env,
    environment,
    now: new Date(),
    makeR2Vault: (env) => createR2Vault(readR2Config(env)),
    backupTools: backupVerifyTools(),
    makeDriveVault: (config) => createDriveVault(config),
  });
  for (const c of checks) console.log(`  ${c.ok ? 'READY    ' : 'NOT READY'} ${c.check.padEnd(14)} ${c.detail}`);
  const ready = checks.length === 6 && checks.every((c) => c.ok);
  console.log(ready ? '\nSTORAGE READY. (This check deletes nothing.)\n' : '\nSTORAGE NOT READY.\n');
  return ready ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('\nREADINESS CHECK ABORTED:', msg(err));
      process.exit(1);
    });
}
