/**
 * Google Drive archive vault health check. Backend-only.
 *
 *   npm run admin:drive:verify -- --environment=staging
 *   npm run admin:drive:verify -- --environment=staging --init-root   (first time only)
 *
 * Proves, without touching the database or any user:
 *
 *   1. OAuth works with the configured refresh token.
 *   2. The signed-in account is exactly GOOGLE_DRIVE_ARCHIVE_ACCOUNT.
 *   3. The configured archive root exists and was created by this tool.
 *   4. The environment folder is labelled for THIS environment, so a staging
 *      run can never write into the production folder (or the reverse).
 *   4a. Every folder in Apex OS Secure Archives/<environment>/healthcheck is
 *      private (owner only, My Drive, correct label) -- before the upload and
 *      again after the test file is deleted. Health-check files only ever go
 *      to <environment>/healthcheck, never to deleted-users.
 *   5. Storage quota is available.
 *   6. A random test file can be uploaded (resumable), downloaded, and its
 *      SHA-256 matches.
 *   7. The file is private (owner only).
 *   8. It can be deleted, and is then gone.
 *
 * --init-root creates the "Apex OS Secure Archives" folder in My Drive and
 * prints its id for GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID. The `drive.file`
 * scope cannot see folders created by hand, which is why the tool creates it.
 *
 * Never prints a credential, token or URL. Exits non-zero on any failure, and
 * removes the local temporary file and the remote test file in every case.
 */

import { createHash, randomBytes, randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertArchiveAccount, createDriveVault, isArchiveAccount, readDriveConfig, type ArchiveVault, type DriveConfig } from '../../src/modules/platform/backup-vault/drive-vault';
import { verifyFolderChain } from '../../src/modules/platform/backup-vault/drive-folder-privacy';

export const MIN_FREE_BYTES = 100 * 1024 * 1024;

export interface DriveCheck {
  step: string;
  ok: boolean;
  detail: string;
}

export async function verifyDriveVault(vault: ArchiveVault, config: DriveConfig): Promise<DriveCheck[]> {
  const checks: DriveCheck[] = [];
  const pass = (step: string, detail: string) => checks.push({ step, ok: true, detail });
  const failAndStop = (step: string, detail: string) => {
    checks.push({ step, ok: false, detail });
    return checks;
  };

  let account;
  try {
    account = await vault.account();
  } catch (err: any) {
    return failAndStop('oauth', String(err?.message ?? err));
  }
  pass('oauth', 'Access token obtained from the refresh token.');
  if (!isArchiveAccount(account.email, config.account)) return failAndStop('account', 'Signed in as a different Google account than GOOGLE_DRIVE_ARCHIVE_ACCOUNT.');
  pass('account', 'Signed in as the configured archive account.');

  if (account.freeBytes !== null && account.freeBytes < MIN_FREE_BYTES) {
    return failAndStop('quota', `Less than ${MIN_FREE_BYTES / 1024 / 1024} MiB of Drive storage is free.`);
  }
  pass('quota', account.freeBytes === null ? 'Storage is unlimited.' : `${Math.floor(account.freeBytes / 1024 / 1024)} MiB free.`);

  let folderId: string;
  try {
    folderId = await vault.ensureFolder(config.environment, ['healthcheck']);
  } catch (err: any) {
    return failAndStop('folders', String(err?.message ?? err));
  }
  pass('folders', `Archive root and the ${config.environment} folder exist and are labelled for ${config.environment}.`);
  try {
    await verifyFolderChain(vault, config.environment, ['healthcheck']);
  } catch (err: any) {
    return failAndStop('folders-private', String(err?.message ?? err));
  }
  pass('folders-private', `Apex OS Secure Archives/${config.environment}/healthcheck is owner-only, in My Drive, and correctly labelled.`);

  const dir = mkdtempSync(join(tmpdir(), 'apex-drive-verify-'));
  let fileId: string | null = null;
  try {
    const bytes = randomBytes(256 * 1024 + 123);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const local = join(dir, 'probe.bin');
    writeFileSync(local, bytes);

    const up = await vault.upload(folderId, `healthcheck-${randomUUID()}.bin`, local, {
      apexArchiveEnvironment: config.environment,
      apexArchiveKind: 'healthcheck',
    });
    fileId = up.fileId;
    if (up.size !== bytes.length) return failAndStop('upload', `Drive recorded ${up.size} bytes, sent ${bytes.length}.`);
    pass('upload', 'Resumable upload completed and returned a file id.');

    const back = join(dir, 'probe.download');
    await vault.download(fileId, back);
    const got = createHash('sha256').update(readFileSync(back)).digest('hex');
    if (got !== sha) return failAndStop('download', 'The downloaded copy has a different SHA-256.');
    pass('download', 'Downloaded copy matches by SHA-256.');

    if (!(await vault.isPrivate(fileId))) return failAndStop('private', 'The test file is shared beyond its owner.');
    pass('private', 'The test file is private to the owner.');

    await vault.remove(fileId);
    const after = await vault.stat(fileId);
    fileId = null;
    if (after && !after.trashed) return failAndStop('delete', 'The test file still exists after deletion.');
    pass('delete', 'The test file was deleted and is gone.');

    try {
      await verifyFolderChain(vault, config.environment, ['healthcheck']);
    } catch (err: any) {
      return failAndStop('folders-private-after', String(err?.message ?? err));
    }
    pass('folders-private-after', 'The folder chain is still private after the round trip.');
    return checks;
  } catch (err: any) {
    return failAndStop('roundtrip', String(err?.message ?? err));
  } finally {
    if (fileId) await vault.remove(fileId).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const environment = (args.find((a) => a.startsWith('--environment='))?.split('=')[1] ?? '').trim().toLowerCase();
  if (environment !== 'staging' && environment !== 'production') throw new Error('--environment must be "staging" or "production".');
  const appEnv = (process.env.APP_ENV ?? '').trim().toLowerCase();
  if (appEnv !== environment) throw new Error(`APP_ENV is "${appEnv || '(unset)'}" but --environment is "${environment}".`);

  console.log('── Apex OS Google Drive archive vault check ───────────────────');
  if (args.includes('--init-root')) {
    const config = readDriveConfig(process.env, environment, { requireRoot: false });
    if (config.rootFolderId) throw new Error('GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID is already set; refusing to create a second root.');
    const vault = createDriveVault(config);
    const who = await vault.account();
    assertArchiveAccount(who.email, config.account);
    const id = await vault.createRoot();
    console.log(`  Created the archive root folder. Set GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID=${id}`);
    return 0;
  }

  const config = readDriveConfig(process.env, environment);
  const checks = await verifyDriveVault(createDriveVault(config), config);
  for (const c of checks) console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.step.padEnd(10)} ${c.detail}`);
  const ok = checks.length > 0 && checks.every((c) => c.ok) && checks.some((c) => c.step === 'folders-private-after');
  console.log(ok ? '\nARCHIVE VAULT VERIFIED.\n' : '\nARCHIVE VAULT CHECK FAILED.\n');
  return ok ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('\nDRIVE CHECK ABORTED:', err?.message ?? err);
      process.exit(1);
    });
}
