import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Attendance punch photo transport (PE-3).
 *
 * Uses the shared authenticated client directly rather than adding a group to
 * frontend/lib/api.ts — that façade is being drained, and new code should not
 * grow it.
 */

export interface UploadedPunchPhoto {
  photoAssetId: string;
  expiresAt: string;
}

/**
 * Uploads one camera capture and returns its opaque asset id.
 *
 * Sends BYTES as multipart. The server derives the owner, the storage location
 * and the hash — none of them are sent from here, and there is no code path
 * that submits a photo URL.
 */
export async function uploadPunchPhoto(
  blob: Blob,
  clientCapturedAt: Date,
): Promise<UploadedPunchPhoto> {
  const form = new FormData();
  // Filename is cosmetic; the server validates the actual bytes.
  form.append('photo', blob, `punch-${Date.now()}.jpg`);
  form.append('clientCapturedAt', clientCapturedAt.toISOString());

  return r(api.post('/attendance/punch-photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }));
}
