import { Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, type drive_v3 } from 'googleapis';
import {
  compareArchive,
  type ArchiveUploadRequest,
  type ArchiveVerification,
  type ArchiveVerifyRequest,
  type EmployeeArchiveStorage,
  type UploadedArchive,
} from './employee-archive-storage';

/**
 * Employee archives, in Google Drive.
 *
 * MANDATORY DESTINATION. This is not one storage option among several -- the
 * deletion is gated on a verified archive existing HERE. R2, S3, Cloudinary
 * and the local disk are all explicitly not substitutes, so there is no
 * fallback path when Drive is unavailable: the archive fails, and therefore
 * so does the deletion, which is the correct outcome.
 *
 * CREDENTIALS COME FROM CONFIG AND NEVER LEAVE IT. Nothing here logs, returns
 * or stores the private key. The config check reports WHICH variable is
 * missing, never any value, and the error surfaced to an administrator says
 * that Drive is not configured without saying anything about what it was
 * configured with.
 */
@Injectable()
export class GoogleDriveEmployeeArchiveStorage implements EmployeeArchiveStorage {
  private readonly logger = new Logger(GoogleDriveEmployeeArchiveStorage.name);

  constructor(private readonly config: ConfigService) {}

  // ── Configuration ──────────────────────────────────────────────────────

  /**
   * Reads and validates the three settings Drive needs.
   *
   * THROWS WITH NAMES, NEVER VALUES. "GOOGLE_DRIVE_PRIVATE_KEY is not set" is
   * useful; echoing any part of a key into a log or an HTTP response is the
   * kind of helpfulness that ends up in an incident report.
   */
  private settings(): { clientEmail: string; privateKey: string; folderId: string } {
    const clientEmail = this.config.get<string>('GOOGLE_DRIVE_CLIENT_EMAIL');
    const rawKey = this.config.get<string>('GOOGLE_DRIVE_PRIVATE_KEY');
    const folderId = this.config.get<string>('GOOGLE_DRIVE_ARCHIVE_FOLDER_ID');

    const missing = [
      !clientEmail && 'GOOGLE_DRIVE_CLIENT_EMAIL',
      !rawKey && 'GOOGLE_DRIVE_PRIVATE_KEY',
      !folderId && 'GOOGLE_DRIVE_ARCHIVE_FOLDER_ID',
    ].filter(Boolean);

    if (missing.length) {
      throw new Error(
        `Google Drive archiving is not configured. Missing: ${missing.join(', ')}.`,
      );
    }

    return {
      clientEmail: clientEmail!,
      // A PEM carries real newlines. Environment variables and dashboards
      // almost always deliver it with literal backslash-n instead, and the
      // resulting failure is an opaque "invalid key" from the JWT signer.
      privateKey: rawKey!.replace(/\\n/g, '\n'),
      folderId: folderId!,
    };
  }

  /** True when Drive could be used at all. Used to fail early, with a clear reason. */
  isConfigured(): boolean {
    try {
      this.settings();
      return true;
    } catch {
      return false;
    }
  }

  configurationProblem(): string | null {
    try {
      this.settings();
      return null;
    } catch (err: any) {
      return err?.message ?? 'Google Drive archiving is not configured.';
    }
  }

  private client(): drive_v3.Drive {
    const { clientEmail, privateKey } = this.settings();
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      // The narrowest scope that can create and read back a file. `drive.file`
      // limits this service account to files it created itself, so a bug here
      // cannot read or damage the rest of the Drive.
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    return google.drive({ version: 'v3', auth });
  }

  // ── Upload ─────────────────────────────────────────────────────────────

  async upload(request: ArchiveUploadRequest): Promise<UploadedArchive> {
    const { folderId } = this.settings();
    const drive = this.client();

    const created = await drive.files.create({
      requestBody: {
        name: request.fileName,
        parents: [folderId],
        description: request.description,
        mimeType: 'application/zip',
      },
      media: {
        mimeType: 'application/zip',
        body: Readable.from(request.buffer),
      },
      // Asked for explicitly: without `fields`, Drive returns id alone and
      // there is nothing to check the upload against.
      fields: 'id, name, size, parents, md5Checksum',
    });

    const file = created.data;
    if (!file?.id) {
      // Drive answered without an id. Treated as a failure rather than
      // shrugged at, because every later step keys off this value.
      throw new Error('Google Drive did not return a file id for the uploaded archive.');
    }

    this.logger.log(
      `Employee archive uploaded to Drive: ${file.id} (${request.fileName})`,
    );

    return {
      fileId: file.id,
      fileName: file.name ?? request.fileName,
      bytes: file.size === null || file.size === undefined ? null : Number(file.size),
      folderId: file.parents?.[0] ?? null,
    };
  }

  // ── Verification ───────────────────────────────────────────────────────

  /**
   * Asks Drive what it actually holds, and compares.
   *
   * A SEPARATE READ, NOT THE UPLOAD RESPONSE. The upload response describes
   * the request that was accepted; this describes the object that exists. The
   * difference matters exactly once -- when they disagree -- and that is the
   * case the deletion must not proceed through.
   */
  async verify(request: ArchiveVerifyRequest): Promise<ArchiveVerification> {
    const { folderId } = this.settings();
    const drive = this.client();

    let observed: ArchiveVerification['observed'] = {
      fileId: null, fileName: null, bytes: null, folderId: null, checksum: null,
    };

    try {
      const found = await drive.files.get({
        fileId: request.fileId,
        fields: 'id, name, size, parents, md5Checksum, trashed',
      });
      const file = found.data;

      observed = {
        fileId: file?.id ?? null,
        fileName: file?.name ?? null,
        bytes: file?.size === null || file?.size === undefined ? null : Number(file.size),
        folderId: file?.parents?.[0] ?? null,
        // Drive reports MD5, not SHA-256, which is why the request carries a
        // provider-shaped hash to compare against.
        checksum: file?.md5Checksum ?? null,
      };

      if (file?.trashed) {
        // A trashed file still answers files.get. Verifying it would be
        // verifying something already on its way to being gone.
        return {
          verified: false,
          problems: ['The uploaded archive is in the Drive trash.'],
          observed,
        };
      }
    } catch (err: any) {
      // A failed read is a failed verification. It is never treated as
      // "probably fine": the whole purpose is positive evidence.
      return {
        verified: false,
        problems: [
          `Could not read the uploaded archive back from Google Drive: ${err?.message ?? 'unknown error'}`,
        ],
        observed,
      };
    }

    return compareArchive(request, observed, { expectedFolderId: folderId });
  }
}
