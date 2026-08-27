import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

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
  private configured = false;

  constructor(private readonly config: ConfigService) {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
      this.configured = true;
    }
  }

  isConfigured() {
    return this.configured;
  }

  /**
   * Uploads bytes privately and returns an opaque storage reference.
   *
   * `type: 'authenticated'` means Cloudinary will not serve the asset from a
   * plain URL -- reads require a signature, so there is no permanent
   * unauthenticated link to an employee's photograph.
   */
  async upload(userId: string, buffer: Buffer, mimeType: string): Promise<string> {
    if (!this.configured) {
      // No base64 fallback on purpose. Failing the punch is far better than
      // silently downgrading evidence storage.
      throw new ServiceUnavailableException(
        'Attendance photo storage is not configured. Punch photos cannot be accepted.',
      );
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
    if (!this.configured) {
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
}
