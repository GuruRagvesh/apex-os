import { Injectable, Logger, Optional, ServiceUnavailableException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';

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
