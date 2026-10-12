import { Injectable, Logger, Optional, ServiceUnavailableException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import { createHash } from 'crypto';
import { createR2Vault, readR2Config, VaultNotConfigured, type Vault } from './r2-vault';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDriveVault, DRIVE_ROOT_NAME, DriveRefused, isArchiveAccount, readDriveConfig, type DriveConfig } from './drive-vault';
import { FolderNotPrivate, verifyFolderChain } from './drive-folder-privacy';

/** What a verified Google Drive user archive can prove. Never carries a credential or token. */
export interface VerifiedDriveArchive {
  provider: 'google-drive';
  environment: 'staging' | 'production';
  /** Apex OS Secure Archives/<environment>/archived-users/<yyyy> */
  folderPath: string;
  fileId: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  verifiedAt: string;
}

/** What a verified archive can prove. Never carries a credential. */
export interface VerifiedArchive {
  provider: 'r2';
  bucket: string;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
  verifiedAt: string;
}

@Injectable()
export class BackupVaultService {
  private readonly logger = new Logger('BackupVaultService');

  private readonly tenantId: string | undefined;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly userId: string | undefined;
  private readonly folderPath: string | undefined;

  constructor(@Optional() private configService?: ConfigService) {
    const get = (k: string) => this.configService?.get<string>(k) ?? process.env[k];
    this.tenantId     = get('MICROSOFT_TENANT_ID');
    this.clientId     = get('MICROSOFT_CLIENT_ID');
    this.clientSecret = get('MICROSOFT_CLIENT_SECRET');
    this.userId       = get('ONEDRIVE_USER_ID');
    this.folderPath   = get('ONEDRIVE_BACKUP_FOLDER_PATH');
  }

  /**
   * Saves buffer to the configured OneDrive backup vault via Microsoft Graph.
   * Throws ServiceUnavailableException if any required env var is missing.
   * Throws InternalServerErrorException if token request or upload fails.
   * Caller MUST NOT anonymize the user if this throws.
   */
  /**
   * Stores an archive in the production R2 vault and PROVES it landed.
   *
   * This is the only path allowed to authorise retiring an account, and it is
   * fail-closed at every step: a caller that receives a VerifiedArchive knows
   * the bytes are in the vault, because this method read them back.
   *
   * It replaces a flow that wrote to OneDrive and then trusted a boolean the
   * BROWSER sent -- `confirmBackupDownloaded` -- as evidence a durable copy
   * existed. A download cannot be verified by the server that offered it, and
   * the OneDrive vault has an unresolved 404. Neither is a basis for making an
   * account unusable.
   *
   * Objects are immutable: the key carries a timestamp, so a retry writes a new
   * one and no archive is ever overwritten.
   */
  async archiveToVault(
    objectKey: string,
    buffer: Buffer,
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ): Promise<VerifiedArchive> {
    let vault: Vault;
    let bucket: string;
    try {
      const config = readR2Config(process.env);
      bucket = config.bucket;
      vault = createR2Vault(config);
    } catch (err) {
      // Missing configuration is a refusal, never a silent skip: an archive
      // with nowhere to go is not an archive.
      if (err instanceof VaultNotConfigured) {
        throw new ServiceUnavailableException(
          'Backup vault is not configured, so this account cannot be archived. ' +
            'Set the R2 credentials before retiring any user.',
        );
      }
      throw err;
    }

    // Hashed BEFORE upload, from the bytes actually sent.
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    if (typeof vault.putBuffer !== 'function') {
      // A vault that cannot take bytes cannot prove it stored them.
      throw new ServiceUnavailableException(
        'The configured backup vault cannot store an in-memory archive. The account has not been changed.',
      );
    }

    try {
      await vault.putBuffer(objectKey, buffer, contentType);
    } catch (err: any) {
      this.logger.error(`User archive upload failed for ${objectKey}: ${err?.message ?? err}`);
      throw new ServiceUnavailableException(
        'The archive could not be uploaded to the backup vault. The account has not been changed.',
      );
    }

    // Read it back. An upload that returned 200 and stored nothing is exactly
    // the failure this whole sequence exists to catch.
    let head: { key: string; byteSize: number } | null;
    try {
      head = await vault.head(objectKey);
    } catch (err: any) {
      this.logger.error(`User archive verification errored for ${objectKey}: ${err?.message ?? err}`);
      throw new ServiceUnavailableException(
        'The archive could not be verified in the backup vault. The account has not been changed.',
      );
    }

    if (!head) {
      throw new ServiceUnavailableException(
        'The archive is not present in the backup vault after upload. The account has not been changed.',
      );
    }
    if (head.byteSize !== buffer.length) {
      throw new ServiceUnavailableException(
        `The archive in the backup vault is ${head.byteSize} bytes but ${buffer.length} were sent. ` +
          'The account has not been changed.',
      );
    }

    this.logger.log(`User archive verified in R2: ${objectKey} (${head.byteSize} bytes)`);
    return {
      provider: 'r2',
      bucket,
      objectKey,
      sizeBytes: head.byteSize,
      sha256,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Stores a user's archive in the private Google Drive archive vault and
   * PROVES it landed. This is what "Archive user" uses; R2 holds database
   * backups and attendance-import files, never user archives.
   *
   *   Apex OS Secure Archives/<APP_ENV>/archived-users/<yyyy>/<fileName>
   *
   * Fail-closed at every step, all before the account is touched:
   *   - APP_ENV must be staging or production, and GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT
   *     must agree, so staging can never write into the production folder;
   *   - the signed-in Google account must be GOOGLE_DRIVE_ARCHIVE_ACCOUNT;
   *   - every folder on the path must be owner-only, in My Drive, and labelled
   *     for this environment (checked before and after creating the year folder);
   *   - after upload the file must be present at the sent size, owner-only, and
   *     its downloaded bytes must hash to the SHA-256 computed here.
   *
   * The bytes touch disk only in a private temporary folder that is removed
   * afterwards. No credential, token or upload URL is logged or returned.
   */
  async archiveUserToDrive(fileName: string, buffer: Buffer, now: Date = new Date()): Promise<VerifiedDriveArchive> {
    const unchanged = 'The account has not been changed.';
    const environment = (process.env.APP_ENV ?? '').trim().toLowerCase();
    if (environment !== 'staging' && environment !== 'production') {
      throw new ServiceUnavailableException(
        `User archives are stored in Google Drive only from staging or production, and APP_ENV is "${environment || '(unset)'}". ${unchanged}`,
      );
    }
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(fileName)) {
      throw new InternalServerErrorException(`The archive file name is not valid. ${unchanged}`);
    }

    let config: DriveConfig;
    try {
      config = readDriveConfig(process.env, environment);
    } catch (err) {
      if (err instanceof DriveRefused) {
        throw new ServiceUnavailableException(
          `The Google Drive archive vault is not ready, so this account cannot be archived: ${err.message.replace(/^Google Drive archive vault refused: /, '')} ${unchanged}`,
        );
      }
      throw err;
    }

    const vault = createDriveVault(config);
    const segments = ['archived-users', String(now.getUTCFullYear())];
    const folderPath = `${DRIVE_ROOT_NAME}/${environment}/${segments.join('/')}`;
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const refuse = (message: string) => new ServiceUnavailableException(`${message} ${unchanged}`);
    const step = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err: any) {
        if (err instanceof FolderNotPrivate) throw refuse(err.message);
        this.logger.error(`User archive: Google Drive ${what} failed: ${String(err?.message ?? err).split('\n')[0].slice(0, 200)}`);
        throw refuse(`The archive could not be ${what} in Google Drive.`);
      }
    };

    const dir = mkdtempSync(join(tmpdir(), 'apex-user-archive-'));
    try {
      const who = await step('authorised', () => vault.account());
      if (!isArchiveAccount(who.email, config.account)) {
        throw refuse('Google Drive is signed in as a different account from GOOGLE_DRIVE_ARCHIVE_ACCOUNT.');
      }

      await step('checked', () => verifyFolderChain(vault, environment, []));
      const folderId = await step('stored', () => vault.ensureFolder(environment, segments));
      await step('checked', () => verifyFolderChain(vault, environment, segments));

      const local = join(dir, 'archive.bin');
      writeFileSync(local, buffer, { mode: 0o600 });
      const uploaded = await step('uploaded', () =>
        vault.upload(folderId, fileName, local, { apexArchiveKind: 'archived-user', apexArchiveEnvironment: environment, sha256 }),
      );

      // Read it back. An upload that returned 200 and stored nothing, or the
      // wrong bytes, is exactly what this sequence exists to catch.
      const info = await step('verified', () => vault.stat(uploaded.fileId));
      if (!info || info.trashed || !info.parents.includes(folderId)) {
        throw refuse('The archive is not present in its Google Drive folder after upload.');
      }
      if (info.size !== buffer.length) {
        throw refuse(`The archive in Google Drive is ${info.size} bytes but ${buffer.length} were sent.`);
      }
      if (!(await step('verified', () => vault.isPrivate(uploaded.fileId)))) {
        throw refuse('The archive file in Google Drive is shared beyond the archive account; fix its sharing in Google Drive.');
      }
      const readBack = join(dir, 'archive.readback');
      await step('downloaded', () => vault.download(uploaded.fileId, readBack));
      if (createHash('sha256').update(readFileSync(readBack)).digest('hex') !== sha256) {
        throw refuse('The archive downloaded from Google Drive does not match what was sent.');
      }

      this.logger.log(`User archive verified in Google Drive: ${folderPath}/${fileName} (${buffer.length} bytes)`);
      return {
        provider: 'google-drive',
        environment,
        folderPath,
        fileId: uploaded.fileId,
        fileName,
        sizeBytes: buffer.length,
        sha256,
        verifiedAt: new Date().toISOString(),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * @deprecated NOT A PRODUCTION SAFETY PATH. Use archiveToVault().
   *
   * Writes to OneDrive via Microsoft Graph. It has no callers, it verifies
   * nothing after upload, and the OneDrive vault has an unresolved 404 -- so it
   * cannot prove a durable copy exists and must never gate archival or
   * disaster recovery again. Kept only so a future business-readable archive
   * has somewhere to start; a test fails the build if production code calls it.
   */
  async save(buffer: Buffer, filename: string): Promise<{ fileRef: string; provider: string }> {
    if (!this.tenantId || !this.clientId || !this.clientSecret || !this.userId || !this.folderPath) {
      throw new ServiceUnavailableException(
        'Backup vault not configured. Set MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, ' +
        'MICROSOFT_CLIENT_SECRET, ONEDRIVE_USER_ID, and ONEDRIVE_BACKUP_FOLDER_PATH environment variables to enable archival.',
      );
    }

    const accessToken = await this.getAccessToken();
    const fileRef = await this.uploadFile(accessToken, buffer, filename);
    this.logger.log(`Backup saved to OneDrive: ${fileRef} (${filename})`);
    return { fileRef, provider: 'onedrive' };
  }

  // ── Microsoft Graph client credentials token ─────────────────────────────────

  private async getAccessToken(): Promise<string> {
    const body = Buffer.from(
      `client_id=${encodeURIComponent(this.clientId!)}&` +
      `client_secret=${encodeURIComponent(this.clientSecret!)}&` +
      `scope=${encodeURIComponent('https://graph.microsoft.com/.default')}&` +
      `grant_type=client_credentials`,
    );

    const res = await this.httpsRequest(
      'login.microsoftonline.com',
      `/${this.tenantId!}/oauth2/v2.0/token`,
      'POST',
      body,
      'application/x-www-form-urlencoded',
    );

    const parsed = JSON.parse(res.body) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!parsed.access_token) {
      this.logger.error(`Microsoft auth failed: ${res.body}`);
      throw new InternalServerErrorException(
        `Backup vault: Microsoft authentication failed. ` +
        (parsed.error_description ?? parsed.error ?? 'Verify MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, and MICROSOFT_CLIENT_SECRET.'),
      );
    }
    return parsed.access_token;
  }

  // ── OneDrive simple upload via Graph path-based API ──────────────────────────

  private async uploadFile(accessToken: string, buffer: Buffer, filename: string): Promise<string> {
    // Encode each path segment individually; preserve the leading slash.
    const encodedFolder = (this.folderPath!.startsWith('/') ? this.folderPath! : `/${this.folderPath!}`)
      .replace(/\/$/, '')
      .split('/')
      .map((s) => (s ? encodeURIComponent(s) : s))
      .join('/');

    // Graph path-based simple upload — creates the file (and any missing parent
    // folders) at the specified path under the target user's OneDrive.
    const graphPath =
      `/v1.0/users/${encodeURIComponent(this.userId!)}` +
      `/drive/root:${encodedFolder}/${encodeURIComponent(filename)}:/content`;

    const res = await this.httpsRequest(
      'graph.microsoft.com',
      graphPath,
      'PUT',
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      { Authorization: `Bearer ${accessToken}` },
    );

    if (res.statusCode !== 200 && res.statusCode !== 201) {
      this.logger.error(`OneDrive upload failed (${res.statusCode}): ${res.body}`);
      throw new InternalServerErrorException(
        `Backup vault: OneDrive upload failed (HTTP ${res.statusCode}). ` +
        'Check ONEDRIVE_BACKUP_FOLDER_PATH exists, ONEDRIVE_USER_ID is correct, and the app has Files.ReadWrite.All permission.',
      );
    }

    const parsed = JSON.parse(res.body) as { id?: string; webUrl?: string };
    return parsed.id ?? parsed.webUrl ?? filename;
  }

  // ── Shared HTTPS helper (supports POST and PUT) ───────────────────────────────

  private httpsRequest(
    hostname: string,
    path: string,
    method: string,
    body: Buffer,
    contentType: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname,
          path,
          method,
          headers: {
            'Content-Type': contentType,
            'Content-Length': body.length,
            ...extraHeaders,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
          );
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
