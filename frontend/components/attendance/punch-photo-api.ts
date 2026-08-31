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
export interface PhotoHandoffAuth {
  handoffId: string;
  handoffToken: string;
}

export async function uploadPunchPhoto(
  blob: Blob,
  clientCapturedAt: Date,
  /**
   * Sent only by the phone finishing a QR handoff, which has no session. The
   * server attributes the photo to the employee named on the handoff ROW, not
   * to anything sent from here, and validates the token without consuming it.
   */
  handoff?: PhotoHandoffAuth | null,
): Promise<UploadedPunchPhoto> {
  const form = new FormData();
  // Filename is cosmetic; the server validates the actual bytes.
  form.append('photo', blob, `punch-${Date.now()}.jpg`);
  form.append('clientCapturedAt', clientCapturedAt.toISOString());
  if (handoff) {
    form.append('handoffId', handoff.handoffId);
    form.append('handoffToken', handoff.handoffToken);
  }

  return r(api.post('/attendance/punch-photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }));
}

/**
 * A short-lived signed URL for one of the employee's own punch photos.
 *
 * Minted on demand and deliberately not stored: the URL is a temporary
 * presentation artifact, and persisting it would outlive the scoping that
 * makes it safe. The server resolves the storage key from the evidence row and
 * scopes it to the authenticated user, so an id belonging to somebody else
 * simply does not match.
 */
export async function getOwnPunchPhotoUrl(evidenceId: string): Promise<string> {
  const res = await r<{ url: string }>(
    api.get(`/attendance/punch-evidence/${evidenceId}/photo`),
  );
  return res.url;
}
