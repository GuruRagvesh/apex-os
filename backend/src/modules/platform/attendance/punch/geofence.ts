/**
 * Server-side geofence evaluation (PE-2).
 *
 * Pure functions, no I/O, no Prisma. The client never performs any part of this
 * — it reports where it thinks it is, and the server decides whether that is
 * acceptable.
 */

export type GeofenceVerdict =
  | 'VERIFIED'
  | 'OUTSIDE_GEOFENCE'
  | 'LOW_ACCURACY'
  | 'UNAVAILABLE';

export interface GeofenceDecision {
  verdict: GeofenceVerdict;
  /** Null when no distance could be computed (no GPS). */
  distanceMeters: number | null;
  radiusMeters: number | null;
  accuracyThresholdMeters: number | null;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeofenceConfig {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  minimumAccuracyMeters: number;
}

const EARTH_RADIUS_METERS = 6_371_008.8; // IUGG mean Earth radius

const toRadians = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in metres between two coordinates (Haversine).
 *
 * Accurate to well under a metre at office-geofence scale, which is all this
 * needs — the alternative (Vincenty) buys precision that a consumer GPS
 * reading, typically +/-10-50m, cannot make use of.
 *
 * Throws on non-finite or out-of-range input rather than returning NaN, so a
 * malformed reading can never silently become a passing distance of 0.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  for (const [label, v, lo, hi] of [
    ['latitude', a.latitude, -90, 90],
    ['longitude', a.longitude, -180, 180],
    ['latitude', b.latitude, -90, 90],
    ['longitude', b.longitude, -180, 180],
  ] as [string, number, number, number][]) {
    if (!Number.isFinite(v) || v < lo || v > hi) {
      throw new Error(`Invalid ${label} for distance calculation: ${v}`);
    }
  }

  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Decides whether a reading is acceptable, in a deliberate order.
 *
 *   no coordinates            -> UNAVAILABLE
 *   accuracy worse than the   -> LOW_ACCURACY
 *     configured threshold
 *   distance <= radius        -> VERIFIED
 *   otherwise                 -> OUTSIDE_GEOFENCE
 *
 * Accuracy is checked BEFORE distance on purpose. A reading with a 2km error
 * radius that happens to land on the office is not evidence that someone was at
 * the office; treating it as VERIFIED would make the fence trivially defeatable
 * by degrading GPS.
 *
 * The boundary is inclusive: standing exactly on the radius passes.
 */
export function evaluateGeofence(
  reading: { latitude?: number | null; longitude?: number | null; accuracyMeters?: number | null },
  config: GeofenceConfig,
): GeofenceDecision {
  const base = {
    radiusMeters: config.radiusMeters,
    accuracyThresholdMeters: config.minimumAccuracyMeters,
  };

  const { latitude, longitude, accuracyMeters } = reading;
  if (
    latitude === null || latitude === undefined ||
    longitude === null || longitude === undefined
  ) {
    return { verdict: 'UNAVAILABLE', distanceMeters: null, ...base };
  }

  const distanceMeters = haversineMeters(
    { latitude, longitude },
    { latitude: config.latitude, longitude: config.longitude },
  );

  if (
    accuracyMeters === null || accuracyMeters === undefined ||
    accuracyMeters > config.minimumAccuracyMeters
  ) {
    // Distance is still recorded: an out-of-range reading is worth keeping even
    // when it cannot be trusted enough to verify.
    return { verdict: 'LOW_ACCURACY', distanceMeters, ...base };
  }

  return {
    verdict: distanceMeters <= config.radiusMeters ? 'VERIFIED' : 'OUTSIDE_GEOFENCE',
    distanceMeters,
    ...base,
  };
}
