import { Injectable, Logger, Optional, ServiceUnavailableException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';

@Injectable()
export class BackupVaultService {
  private readonly logger = new Logger('BackupVaultService');

  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly refreshToken: string | undefined;
  private readonly folderId: string | undefined;

  constructor(@Optional() private configService?: ConfigService) {
    const get = (k: string) => this.configService?.get<string>(k) ?? process.env[k];
    this.clientId     = get('GOOGLE_DRIVE_CLIENT_ID');
    this.clientSecret = get('GOOGLE_DRIVE_CLIENT_SECRET');
    this.refreshToken = get('GOOGLE_DRIVE_REFRESH_TOKEN');
    this.folderId     = get('BACKUP_VAULT_GDRIVE_FOLDER_ID');
  }

  /**
   * Saves buffer to the configured backup vault.
   * Throws ServiceUnavailableException if not configured.
   * Throws InternalServerErrorException if the upload fails.
   * Caller MUST NOT anonymize the user if this throws.
   */
  async save(buffer: Buffer, filename: string): Promise<{ fileRef: string; provider: string }> {
    if (!this.clientId || !this.clientSecret || !this.refreshToken || !this.folderId) {
      throw new ServiceUnavailableException(
        'Backup vault not configured. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, ' +
        'GOOGLE_DRIVE_REFRESH_TOKEN, and BACKUP_VAULT_GDRIVE_FOLDER_ID environment variables to enable archival.',
      );
    }

    const accessToken = await this.getAccessToken();
    const fileId = await this.uploadFile(accessToken, buffer, filename);
    this.logger.log(`Backup saved to Google Drive: ${fileId} (${filename})`);
    return { fileRef: fileId, provider: 'gdrive' };
  }

  private async getAccessToken(): Promise<string> {
    const body = Buffer.from(
      `client_id=${encodeURIComponent(this.clientId!)}&` +
      `client_secret=${encodeURIComponent(this.clientSecret!)}&` +
      `refresh_token=${encodeURIComponent(this.refreshToken!)}&` +
      `grant_type=refresh_token`,
    );
    const res = await this.post('oauth2.googleapis.com', '/token', body, 'application/x-www-form-urlencoded');
    const parsed = JSON.parse(res.body) as { access_token?: string };
    if (!parsed.access_token) {
      this.logger.error(`GDrive token refresh failed: ${res.body}`);
      throw new InternalServerErrorException(
        'Backup vault: Google Drive authentication failed. Verify GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN.',
      );
    }
    return parsed.access_token;
  }

  private async uploadFile(accessToken: string, buffer: Buffer, filename: string): Promise<string> {
    const boundary = 'apex_vault_bnd_x7k2';
    const CRLF = '\r\n';
    const meta = JSON.stringify({
      name: filename,
      parents: [this.folderId!],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}${CRLF}Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}${meta}${CRLF}`),
      Buffer.from(`--${boundary}${CRLF}Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet${CRLF}${CRLF}`),
      buffer,
      Buffer.from(`${CRLF}--${boundary}--`),
    ]);

    const res = await this.post(
      'www.googleapis.com',
      '/upload/drive/v3/files?uploadType=multipart&fields=id',
      body,
      `multipart/related; boundary=${boundary}`,
      { Authorization: `Bearer ${accessToken}` },
    );

    if (res.statusCode !== 200) {
      this.logger.error(`GDrive upload failed (${res.statusCode}): ${res.body}`);
      throw new InternalServerErrorException(
        `Backup vault: Google Drive upload failed (HTTP ${res.statusCode}). Check folder permissions and credentials.`,
      );
    }
    const parsed = JSON.parse(res.body) as { id?: string };
    if (!parsed.id) {
      throw new InternalServerErrorException('Backup vault: Drive returned no file ID after upload.');
    }
    return parsed.id;
  }

  private post(
    hostname: string,
    path: string,
    body: Buffer,
    contentType: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname,
          path,
          method: 'POST',
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
