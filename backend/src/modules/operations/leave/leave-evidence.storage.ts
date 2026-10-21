import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

/**
 * Private storage for leave evidence files (Phase 3, Emergency Leave).
 *
 * Same rules as attendance photos: authenticated Cloudinary in deployed
 * environments, a private local directory only in development, and FAIL CLOSED
 * when neither is configured -- evidence is never embedded in the database and
 * never placed behind a public URL. The storage key is opaque and is never
 * returned to clients; files are read only through the authorized download
 * route.
 */

export const LEAVE_EVIDENCE_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const LEAVE_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class LeaveEvidenceStorage {
  private readonly provider: 'cloudinary' | 'local-private' | 'unconfigured';
  private readonly localDirectory: string;

  constructor(private readonly config: ConfigService) {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
      this.provider = 'cloudinary';
    } else if (['development', 'test'].includes(this.config.get<string>('NODE_ENV') ?? '')) {
      this.provider = 'local-private';
    } else {
      this.provider = 'unconfigured';
    }
    this.localDirectory = resolve(
      // The same private directory as attendance photos, so the lifecycle
      // archive and Permanent Delete cleanup handle these files the same way.
      this.config.get<string>('ATTENDANCE_PHOTO_LOCAL_DIR') || resolve(process.cwd(), 'private', 'attendance-punch-photos'),
    );
  }

  isConfigured() {
    return this.provider !== 'unconfigured';
  }

  async upload(userId: string, buffer: Buffer, mimeType: string): Promise<string> {
    if (this.provider === 'unconfigured') {
      throw new ServiceUnavailableException(
        'Leave evidence storage is not configured, so the file was not accepted. The leave request itself is unaffected.',
      );
    }
    if (this.provider === 'local-private') {
      await mkdir(this.localDirectory, { recursive: true });
      const filename = `${randomUUID()}.${EXTENSION[mimeType] ?? 'bin'}`;
      await writeFile(resolve(this.localDirectory, filename), buffer, { flag: 'wx', mode: 0o600 });
      return `local-private:${filename}:${encodeURIComponent(mimeType)}`;
    }
    const result = await new Promise<any>((done, fail) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `apex/leave/evidence/${userId}`,
          resource_type: mimeType === 'application/pdf' ? 'raw' : 'image',
          type: 'authenticated',
          image_metadata: false,
        },
        (err: any, res: any) => (err ? fail(err) : done(res)),
      );
      stream.end(buffer);
    });
    return `cloudinary:authenticated:${result.resource_type || 'raw'}:${encodeURIComponent(result.public_id || '')}:${encodeURIComponent(result.format || '')}`;
  }

  /** Bytes for local storage, or a short-lived signed URL for Cloudinary. */
  async read(storageKey: string): Promise<{ content: Buffer } | { url: string }> {
    if (storageKey.startsWith('local-private:')) {
      if (this.provider !== 'local-private') throw new ServiceUnavailableException('Local leave evidence storage is not available.');
      const match = /^local-private:([0-9a-f-]+\.(?:pdf|jpg|png|webp)):/.exec(storageKey);
      if (!match) throw new ServiceUnavailableException('Stored evidence reference is invalid.');
      return { content: await readFile(resolve(this.localDirectory, match[1])) };
    }
    if (this.provider !== 'cloudinary') throw new ServiceUnavailableException('Leave evidence storage is not configured.');
    const [, , resourceType, publicId, format] = storageKey.split(':');
    return {
      url: cloudinary.url(decodeURIComponent(publicId), {
        resource_type: resourceType || 'raw',
        type: 'authenticated',
        secure: true,
        sign_url: true,
        expires_at: Math.floor(Date.now() / 1000) + 300,
        format: format ? decodeURIComponent(format) : undefined,
      }),
    };
  }
}

/** Magic-byte check, so a renamed executable cannot pass as a PDF or photo. */
export function sniffEvidenceMime(buffer: Buffer): string | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** A safe display file name: no path, no control characters, at most 120 characters. */
export function safeEvidenceFileName(name: unknown, mimeType: string): string {
  const base = typeof name === 'string' ? name.split(/[\\/]/).pop() ?? '' : '';
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(0, 120);
  return cleaned || `evidence.${EXTENSION[mimeType] ?? 'bin'}`;
}
