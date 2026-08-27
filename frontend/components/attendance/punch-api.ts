import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Attendance punch transport (PE-4).
 *
 * Uses the shared authenticated client directly rather than adding a group to
 * frontend/lib/api.ts — that façade is being drained, and new code should not
 * grow it.
 */

export type PunchType = 'PUNCH_IN' | 'PUNCH_OUT';

export interface SubmitPunchInput {
  type: PunchType;
  idempotencyKey: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  clientCapturedAt?: string | null;
  photoAssetId: string;
}

export interface PunchResult {
  id: string;
  type: PunchType;
  workSessionId: string | null;
  businessDate: string;
  serverOccurredAt: string;
  locationVerification: string;
  photoVerification: string;
}

/**
 * One punch's stored evidence, as the owning employee may see it.
 *
 * Mirrors toOwnEvidenceView on the server. Accuracy and distance are separate
 * values on purpose: accuracy is how uncertain the reading was, distance is how
 * far that reading sat from the assigned site. They are never interchangeable.
 */
export interface OwnPunchEvidence {
  id: string;
  type: PunchType;
  businessDate: string;
  serverOccurredAt: string;
  clientCapturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceFromLocationMeters: number | null;
  geofenceRadiusMeters: number | null;
  accuracyThresholdMeters: number | null;
  locationVerification: string;
  locationName: string | null;
  photoAssetId: string | null;
  photoVerification: string;
  workSessionId: string | null;
  source: string;
}

/** The authenticated employee's own punches, newest first. */
export async function getMyPunchEvidence(limit = 90): Promise<OwnPunchEvidence[]> {
  return r(api.get('/attendance/punch-evidence/me', { params: { limit } }));
}

/** Whether Attendance V2 punching is switched on for this deployment. */
export async function getPunchStatus(): Promise<{ enabled: boolean }> {
  return r(api.get('/attendance/punch-evidence/status'));
}

/**
 * Submits one punch.
 *
 * Every derived fact — business date, server time, geofence verdict, the linked
 * work session — is decided by the server. This sends only what the client
 * legitimately owns: intent, position, the photo asset and the retry key.
 */
export async function submitPunch(input: SubmitPunchInput): Promise<PunchResult> {
  return r(api.post('/attendance/punch-evidence', input));
}

/**
 * A key for one deliberate punch attempt.
 *
 * Deliberately random per attempt and reused across network retries of that
 * same attempt, so a dropped response can be safely resent. Never derived from
 * the clock: two taps in the same millisecond would collide, and a retry a
 * second later would read as a brand-new punch.
 */
export function newIdempotencyKey(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Older Safari/WebView: still random, just assembled by hand.
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
