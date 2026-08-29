import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { SettingsService } from '../../settings/settings.service';
import { PunchPhotoStorage } from './punch-photo.storage';
import { IMAGE_REJECTION_TEXT, checkPunchPhotoBytes } from './image-header';
import {
  ATTENDANCE_V2_DEFAULTS,
  ATTENDANCE_V2_SETTING_KEY,
  PunchFeatureDisabledError,
  PunchPhotoValidationError,
} from './punch-evidence.types';

/** Camera formats accepted for attendance capture. */
const ALLOWED = {
  'image/jpeg': (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b: Buffer) =>
    b.length > 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  'image/webp': (b: Buffer) =>
    b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
} as const;

/** Matches the repository's existing 5 MB upload ceiling. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Technical anti-replay window for a live capture, not an HR policy. */
export const PHOTO_TTL_MINUTES = 10;

/**
 * Attendance photo capture (PE-3).
 *
 * Accepts IMAGE BYTES, never a URL. The server decides the storage location and
 * computes the hash; the client contributes only the bytes and, optionally,
 * when its camera captured them.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. It establishes that an authenticated
 * user uploaded these exact bytes recently, that they are a real raster image,
 * and that the capture has not been reused. It cannot establish biometric
 * liveness -- so the resulting state is CAPTURED, never FACE_VERIFIED or
 * LIVENESS_VERIFIED.
 */
@Injectable()
export class PunchPhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly settings: SettingsService,
    private readonly storage: PunchPhotoStorage,
  ) {}

  private async isEnabled(): Promise<boolean> {
    const cfg = await this.settings.get(ATTENDANCE_V2_SETTING_KEY);
    return (cfg?.punchEvidenceEnabled ?? ATTENDANCE_V2_DEFAULTS.punchEvidenceEnabled) === true;
  }

  /**
   * Validates that the bytes really are one of the accepted image formats.
   *
   * The declared MIME type is checked AGAINST THE ACTUAL BYTES rather than
   * trusted. A client can label anything `image/jpeg`; the file signature is
   * what decides. This is why SVG is absent from the list entirely -- it is
   * markup, can carry script, and has no business in a camera capture path.
   */
  private validateBytes(file: { buffer: Buffer; mimetype: string; size: number }) {
    if (!file?.buffer?.length) {
      throw new PunchPhotoValidationError('No photo was uploaded');
    }
    if (file.size > MAX_PHOTO_BYTES || file.buffer.length > MAX_PHOTO_BYTES) {
      throw new PunchPhotoValidationError('Photo exceeds the 5 MB limit');
    }
    const check = (ALLOWED as Record<string, (b: Buffer) => boolean>)[file.mimetype];
    if (!check) {
      throw new PunchPhotoValidationError(
        `Photo type "${file.mimetype}" is not allowed. Use JPEG, PNG or WebP.`,
      );
    }
    if (!check(file.buffer)) {
      throw new PunchPhotoValidationError(
        `Photo content does not match its declared type "${file.mimetype}".`,
      );
    }

    // The client refuses blank, dark and blurred frames, but a client-side gate
    // is a user-experience control, not a security boundary: anything the
    // browser decides can be bypassed by not using the browser. So the server
    // independently proves the bytes are a real image of a plausible size.
    //
    // Header parsing only. Decoding pixels would need a large native module and
    // would buy analysis the client already does adequately; what a client
    // cannot be trusted on is whether the file is an image at all.
    const image = checkPunchPhotoBytes(file.buffer);
    if (!image.ok) {
      throw new PunchPhotoValidationError(IMAGE_REJECTION_TEXT[image.rejection!]);
    }
  }

  /**
   * Stores one capture and returns its opaque asset id.
   *
   * @param userId from the verified JWT, never the request body.
   */
  async upload(
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    clientCapturedAt?: string | Date | null,
  ) {
    if (!(await this.isEnabled())) throw new PunchFeatureDisabledError();

    this.validateBytes(file);

    let captured: Date | null = null;
    if (clientCapturedAt) {
      const t = new Date(clientCapturedAt as any);
      if (Number.isNaN(t.getTime())) {
        throw new PunchPhotoValidationError('clientCapturedAt must be a valid timestamp');
      }
      captured = t;
    }

    // Computed from the bytes the server actually received. A client-supplied
    // hash would prove nothing.
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    const objectKey = await this.storage.upload(userId, file.buffer, file.mimetype);

    const now = this.tva.now();
    return this.prisma.attendancePunchPhoto.create({
      data: {
        userId,
        objectKey,
        sha256,
        mimeType: file.mimetype,
        byteSize: file.buffer.length,
        clientCapturedAt: captured,
        receivedAt: now,
        expiresAt: new Date(now.getTime() + PHOTO_TTL_MINUTES * 60_000),
      },
    });
  }

  /**
   * A short-lived signed URL for a punch's photo, for the owning employee.
   *
   * Scoped by userId in the query itself, so another employee's evidence simply
   * does not match. Manager and HR access arrives with the HR authorization
   * wave.
   */
  async signedUrlForOwnEvidence(userId: string, evidenceId: string): Promise<string | null> {
    const evidence = await this.prisma.attendancePunchEvidence.findFirst({
      where: { id: evidenceId, userId },
      select: { photoObjectKey: true },
    });
    if (!evidence?.photoObjectKey) return null;
    return this.storage.signedUrl(evidence.photoObjectKey);
  }
}
