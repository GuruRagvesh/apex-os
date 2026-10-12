import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

type StorageProvider = 'cloudinary' | 'local-private' | 'unconfigured';

/**
 * Private storage for attendance photos (PE-3).
 *
 * Reuses the repository's existing authenticated-Cloudinary convention -- the
 * `cloudinary:authenticated:<type>:<id>:<fmt>` reference and `sign_url` reads
 * already used by UploadsService for ticket attachments.
 *
 * It deliberately does NOT reuse UploadsService itself. That service falls back
 * to embedding a base64 data URL in Postgres when Cloudinary is unconfigured,
 * which is acceptable for a ticket attachment and not acceptable for attendance
 * evidence: it would put employee photographs in the database and in every
 * backup of it. Here, unconfigured storage FAILS CLOSED.
 */
@Injectable()
export class PunchPhotoStorage {
  private readonly provider: StorageProvider;
  private readonly localDirectory: string;
  private readonly signingSecret: string;
  private readonly localBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
      this.provider = 'cloudinary';
    } else if (this.config.get<string>('NODE_ENV') === 'development') {
      // Local development still needs a real byte store so the complete punch
      // flow can be exercised without production Cloudinary credentials. The
      // files stay outside the public web root and are read only through a
      // short-lived, HMAC-signed URL. Production continues to fail closed.
      this.provider = 'local-private';
    } else {
      this.provider = 'unconfigured';
    }

    this.localDirectory = resolve(
      this.config.get<string>('ATTENDANCE_PHOTO_LOCAL_DIR') ||
        resolve(process.cwd(), 'private', 'attendance-punch-photos'),
    );
    this.signingSecret = this.config.get<string>('JWT_SECRET') || '';
    const port = this.config.get<string>('PORT') || '3001';
    this.localBaseUrl = (
      this.config.get<string>('BACKEND_PUBLIC_URL') || `http://localhost:${port}`
    ).replace(/\/$/, '');
  }

  isConfigured() {
    return this.provider !== 'unconfigured';
  }

  providerName() {
    return this.provider;
  }

  /**
   * Uploads bytes privately and returns an opaque storage reference.
   *
   * `type: 'authenticated'` means Cloudinary will not serve the asset from a
   * plain URL -- reads require a signature, so there is no permanent
   * unauthenticated link to an employee's photograph.
   */
  async upload(userId: string, buffer: Buffer, mimeType: string): Promise<string> {
    if (this.provider === 'unconfigured') {
      // No base64 fallback on purpose. Failing the punch is far better than
      // silently downgrading evidence storage.
      throw new ServiceUnavailableException(
        'Attendance photo storage is not configured. Punch photos cannot be accepted.',
      );
    }

    if (this.provider === 'local-private') {
      if (!this.signingSecret) {
        throw new ServiceUnavailableException(
          'Attendance photo storage signing is not configured.',
        );
      }
      await mkdir(this.localDirectory, { recursive: true });
      const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const filename = `${randomUUID()}.${extension}`;
      await writeFile(resolve(this.localDirectory, filename), buffer, { flag: 'wx', mode: 0o600 });
      return `local-private:${filename}:${encodeURIComponent(mimeType)}`;
    }

    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `apex/attendance/punch/${userId}`,
          resource_type: 'image',
          type: 'authenticated',
          // Strip camera metadata, including GPS EXIF, at the provider. The
          // authoritative location is the separately validated GPS reading, not
          // whatever the camera embedded.
          image_metadata: false,
        },
        (err: any, res: any) => (err ? reject(err) : resolve(res)),
      );
      stream.end(buffer);
    });

    const resourceType = result.resource_type || 'image';
    const publicId = encodeURIComponent(result.public_id || '');
    const format = encodeURIComponent(result.format || '');
    return `cloudinary:authenticated:${resourceType}:${publicId}:${format}`;
  }

  /**
   * A short-lived signed URL for one asset.
   *
   * Never persisted and never logged: it is minted per authorised request and
   * expires on its own.
   */
  signedUrl(objectKey: string, ttlSeconds = 300): string {
    if (objectKey.startsWith('local-private:')) {
      if (this.provider !== 'local-private' || !this.signingSecret) {
        throw new ServiceUnavailableException('Local attendance photo storage is not available.');
      }
      const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
      const payload = Buffer.from(JSON.stringify({ objectKey, expiresAt })).toString('base64url');
      const signature = this.sign(payload);
      return `${this.localBaseUrl}/api/attendance/punch-photo/local/${payload}.${signature}`;
    }

    if (this.provider !== 'cloudinary') {
      throw new ServiceUnavailableException('Attendance photo storage is not configured.');
    }
    const [, , resourceType, publicId, format] = objectKey.split(':');
    if (!publicId) {
      throw new ServiceUnavailableException('Stored photo reference is invalid');
    }
    return cloudinary.url(decodeURIComponent(publicId), {
      resource_type: resourceType || 'image',
      type: 'authenticated',
      secure: true,
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
      format: format ? decodeURIComponent(format) : undefined,
    });
  }

  /** Resolves one development-only signed URL without exposing the directory. */
  async readLocalSignedPhoto(token: string): Promise<{ content: Buffer; mimeType: string }> {
    if (this.provider !== 'local-private' || !this.signingSecret) {
      throw new ServiceUnavailableException('Local attendance photo storage is not available.');
    }

    const separator = token.lastIndexOf('.');
    if (separator <= 0) throw new Error('Invalid photo token');
    const payload = token.slice(0, separator);
    const supplied = token.slice(separator + 1);
    const expected = this.sign(payload);
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    if (
      suppliedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(suppliedBytes, expectedBytes)
    ) {
      throw new Error('Invalid photo token');
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      objectKey?: string;
      expiresAt?: number;
    };
    if (!decoded.expiresAt || decoded.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new Error('Expired photo token');
    }
    const match = /^local-private:([0-9a-f-]+\.(?:jpg|png|webp)):(.+)$/.exec(
      decoded.objectKey || '',
    );
    if (!match) throw new Error('Invalid photo reference');

    return {
      content: await readFile(resolve(this.localDirectory, match[1])),
      mimeType: decodeURIComponent(match[2]),
    };
  }

  private sign(payload: string) {
    return createHmac('sha256', this.signingSecret).update(payload).digest('base64url');
  }
}
