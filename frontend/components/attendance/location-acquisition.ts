/**
 * Progressive location acquisition for a punch.
 *
 * The previous implementation made ONE request with `enableHighAccuracy: true`
 * and `maximumAge: 0` — "give me a brand-new high-precision fix and I will not
 * accept a recent one" — and then collapsed every failure into a single blocked
 * state reading "A punch cannot be recorded without a location".
 *
 * A laptop has no GPS radio, so the browser derives position from network
 * lookup, which is slower and fails more often. POSITION_UNAVAILABLE and
 * TIMEOUT therefore occur while OS location and browser permission are both
 * perfectly enabled, and the employee is told, in effect, that location is off.
 *
 * NOT PROVEN: that this exact combination is what failed on the affected
 * machine. No runtime error code was captured from it. The reasoning is
 * code-level, the fix stands on the brittleness being obvious, and `diagnostic`
 * exists so the next occurrence proves itself.
 *
 * Permission is deliberately NOT consulted as a prerequisite. There is no
 * separate "browser location" and "OS location" to reconcile: navigator.
 * geolocation is the web interface over the device providers, so the call
 * itself is the authority and its error code is the truth.
 *
 * The server remains the authority on accuracy and geofence. Nothing here
 * decides whether a reading is good enough to verify a punch; it only decides
 * which valid sample to submit.
 */

export type LocationFailureCode =
  | 'LOCATION_PERMISSION_DENIED'
  | 'LOCATION_UNAVAILABLE'
  | 'LOCATION_TIMEOUT'
  | 'LOCATION_STALE'
  | 'LOCATION_NOT_SUPPORTED';

export interface LocationSample {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  /** From position.timestamp, not the browser clock at handling time. */
  capturedAt: string;
}

export interface AcquisitionAttemptPlan {
  enableHighAccuracy: boolean;
  maximumAge: number;
  timeout: number;
}

/**
 * Fresh-and-precise first; a bounded recent fix only if that fails.
 *
 * The second attempt is what a laptop usually satisfies. `maximumAge` is
 * bounded rather than unlimited: a fix from two minutes ago is a reasonable
 * claim about where someone is standing, one from an hour ago is not, and
 * staleness is re-checked against position.timestamp regardless.
 */
export const ACQUISITION_PLAN: AcquisitionAttemptPlan[] = [
  { enableHighAccuracy: true, maximumAge: 0, timeout: 8_000 },
  { enableHighAccuracy: true, maximumAge: 120_000, timeout: 15_000 },
];

/** Older than this and the sample is refused whatever maximumAge allowed. */
export const MAX_SAMPLE_AGE_MS = 180_000;

/** Browser PositionError codes. */
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

export function failureFor(code: number | undefined): LocationFailureCode {
  if (code === PERMISSION_DENIED) return 'LOCATION_PERMISSION_DENIED';
  if (code === TIMEOUT) return 'LOCATION_TIMEOUT';
  return 'LOCATION_UNAVAILABLE';
}

/**
 * Only a denial is terminal.
 *
 * Retrying a denial re-prompts a browser that has already refused, which is
 * noise. A timeout or an unavailable position is transient and worth one more
 * attempt with relaxed options.
 */
export function isTerminal(code: LocationFailureCode): boolean {
  return code === 'LOCATION_PERMISSION_DENIED' || code === 'LOCATION_NOT_SUPPORTED';
}

export function toSample(position: any): LocationSample | null {
  const lat = position?.coords?.latitude;
  const lon = position?.coords?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const ts = typeof position?.timestamp === 'number' ? position.timestamp : Date.now();
  return {
    latitude: lat,
    longitude: lon,
    // Kept exactly as reported. Rounding it would make a reading look better
    // than it is, and the server compares it against policy.
    accuracyMeters:
      typeof position?.coords?.accuracy === 'number' ? position.coords.accuracy : null,
    capturedAt: new Date(ts).toISOString(),
  };
}

export function isStale(sample: LocationSample, now: number, maxAgeMs = MAX_SAMPLE_AGE_MS): boolean {
  const at = new Date(sample.capturedAt).getTime();
  if (!Number.isFinite(at)) return true;
  // A timestamp in the future is a broken clock, not a fresh fix.
  return at > now + 60_000 || now - at > maxAgeMs;
}

/**
 * The most precise fresh sample.
 *
 * A sample with no reported accuracy is kept only if nothing better exists: it
 * may still be a real position, and the server will judge it.
 */
export function selectBestSample(
  samples: LocationSample[],
  now: number,
  maxAgeMs = MAX_SAMPLE_AGE_MS,
): LocationSample | null {
  const fresh = samples.filter((s) => !isStale(s, now, maxAgeMs));
  if (fresh.length === 0) return null;

  const measured = fresh.filter((s) => typeof s.accuracyMeters === 'number');
  if (measured.length === 0) return fresh[0];

  return measured.reduce((best, s) =>
    (s.accuracyMeters as number) < (best.accuracyMeters as number) ? s : best,
  );
}

export interface AcquisitionDiagnostic {
  attempts: number;
  /** Failure code per attempt, oldest first. Proves what actually happened. */
  codes: LocationFailureCode[];
  samplesSeen: number;
  staleDiscarded: number;
}

export type AcquisitionOutcome =
  | { ok: true; sample: LocationSample; diagnostic: AcquisitionDiagnostic }
  | { ok: false; failure: LocationFailureCode; diagnostic: AcquisitionDiagnostic };

export type GetPosition = (options: PositionOptions) => Promise<any>;

/**
 * Runs the plan until a usable sample is found.
 *
 * `getPosition` is injected so this is testable without a browser, which is the
 * only way the retry and staleness rules can be proven at all.
 */
export async function acquireLocation(
  getPosition: GetPosition,
  opts: { now?: () => number; plan?: AcquisitionAttemptPlan[]; maxAgeMs?: number } = {},
): Promise<AcquisitionOutcome> {
  const now = opts.now ?? (() => Date.now());
  const plan = opts.plan ?? ACQUISITION_PLAN;
  const maxAgeMs = opts.maxAgeMs ?? MAX_SAMPLE_AGE_MS;

  const samples: LocationSample[] = [];
  const diagnostic: AcquisitionDiagnostic = {
    attempts: 0,
    codes: [],
    samplesSeen: 0,
    staleDiscarded: 0,
  };
  let lastFailure: LocationFailureCode = 'LOCATION_UNAVAILABLE';

  for (const attempt of plan) {
    diagnostic.attempts += 1;
    try {
      const position = await getPosition({
        enableHighAccuracy: attempt.enableHighAccuracy,
        maximumAge: attempt.maximumAge,
        timeout: attempt.timeout,
      });
      const sample = toSample(position);
      if (!sample) {
        lastFailure = 'LOCATION_UNAVAILABLE';
        diagnostic.codes.push(lastFailure);
        continue;
      }

      diagnostic.samplesSeen += 1;
      if (isStale(sample, now(), maxAgeMs)) {
        diagnostic.staleDiscarded += 1;
        lastFailure = 'LOCATION_STALE';
        diagnostic.codes.push(lastFailure);
        continue;
      }

      samples.push(sample);
      // Good enough to stop: a second attempt costs the employee time and the
      // server judges precision anyway.
      break;
    } catch (err: any) {
      lastFailure = failureFor(err?.code);
      diagnostic.codes.push(lastFailure);
      if (isTerminal(lastFailure)) break;
    }
  }

  const best = selectBestSample(samples, now(), maxAgeMs);
  if (best) return { ok: true, sample: best, diagnostic };
  return { ok: false, failure: lastFailure, diagnostic };
}

/** What the employee is told. Never "location is off" for a transient fault. */
export const FAILURE_TEXT: Record<LocationFailureCode, string> = {
  LOCATION_PERMISSION_DENIED:
    'Location access is blocked for this site. Allow location in your browser settings, or use your phone.',
  LOCATION_UNAVAILABLE:
    'Your location could not be determined on this device. This is usually temporary — try again, or use your phone.',
  LOCATION_TIMEOUT:
    'Getting your location is taking longer than expected on this device. Try again, or use your phone.',
  LOCATION_STALE:
    'Only an out-of-date location was available. Try again, or use your phone.',
  LOCATION_NOT_SUPPORTED:
    'This browser cannot provide a location. Use your phone to complete the punch.',
};
