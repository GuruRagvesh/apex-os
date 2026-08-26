import type { OwnPunchEvidence } from './punch-api';

/**
 * How a punch's location evidence is described to a human.
 *
 * Four separate facts, deliberately never collapsed into one number:
 *
 *   GPS ACCURACY      how uncertain the device's reading was (±18 m)
 *   DISTANCE          how far that reading sat from the assigned site (47 m)
 *   GEOFENCE RADIUS   how far the company allows (150 m)
 *   VERIFICATION      the backend's interpretation of those three
 *
 * "±111 m accuracy" does not mean "111 m from the office" — it means the true
 * position is somewhere within roughly 111 m of the reported point. Presenting
 * one as the other is the specific misreading this module exists to prevent, so
 * accuracy and distance are always rendered as separate labelled values.
 *
 * The verdict is the SERVER's. Nothing here re-decides whether a punch was
 * inside a location; it only phrases what the server already concluded.
 */

export type LocationTone = 'good' | 'warn' | 'neutral';

export interface LocationPresentation {
  /** Short verdict, safe to show on the main page. */
  headline: string;
  /** Why, in one line. Empty when there is nothing to add. */
  detail: string;
  tone: LocationTone;
  /** True when certainty does not support a definite claim. */
  uncertain: boolean;
}

function metres(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${Math.round(value)} m`;
}

/** Accuracy, always written with ± so it cannot be read as a distance. */
export function formatAccuracy(accuracyMeters: number | null | undefined): string {
  const m = metres(accuracyMeters);
  return m === null ? '—' : `±${m}`;
}

/** Distance from the assigned site, always written relative to that site. */
export function formatDistance(
  distanceMeters: number | null | undefined,
  locationName?: string | null,
): string {
  const m = metres(distanceMeters);
  if (m === null) return '—';
  return locationName ? `${m} from ${locationName}` : `${m} from assigned site`;
}

/**
 * Turns the server's verdict into a sentence.
 *
 * NOT_ENFORCED is deliberately not phrased as success: geofencing being switched
 * off is not evidence that the employee was inside an approved location, and
 * calling it "verified" would manufacture a certainty nobody established.
 */
export function presentLocation(
  evidence: Pick<
    OwnPunchEvidence,
    | 'locationVerification'
    | 'locationName'
    | 'distanceFromLocationMeters'
    | 'accuracyMeters'
    | 'geofenceRadiusMeters'
  > | null,
): LocationPresentation {
  if (!evidence) {
    return { headline: 'No location evidence', detail: '', tone: 'neutral', uncertain: true };
  }

  const distance = metres(evidence.distanceFromLocationMeters);
  const accuracy = metres(evidence.accuracyMeters);
  const site = evidence.locationName;

  // Both numbers, kept apart in the same sentence.
  const facts = [
    distance ? `${distance} from ${site ?? 'assigned site'}` : null,
    accuracy ? `GPS accuracy ±${accuracy}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  switch (evidence.locationVerification) {
    case 'VERIFIED':
      return {
        headline: site ? `Inside ${site}` : 'Inside approved location',
        detail: facts,
        tone: 'good',
        uncertain: false,
      };

    case 'OUTSIDE_GEOFENCE': {
      const radius = metres(evidence.geofenceRadiusMeters);
      return {
        headline: 'Outside approved location',
        detail: [facts, radius ? `allowed ${radius}` : null].filter(Boolean).join(' · '),
        tone: 'warn',
        uncertain: false,
      };
    }

    case 'LOW_ACCURACY':
      return {
        // The reading exists; it is simply not precise enough to conclude from.
        headline: 'Location captured — low accuracy',
        detail: [facts, 'too imprecise to confirm'].filter(Boolean).join(' · '),
        tone: 'warn',
        uncertain: true,
      };

    case 'NOT_ENFORCED':
      return {
        headline: 'Location captured',
        detail: [facts, 'not checked against a site'].filter(Boolean).join(' · '),
        tone: 'neutral',
        uncertain: true,
      };

    case 'UNAVAILABLE':
      return {
        headline: 'No location captured',
        detail: 'the device did not provide a reading',
        tone: 'warn',
        uncertain: true,
      };

    case 'PENDING':
      return {
        headline: 'Location not yet checked',
        detail: facts,
        tone: 'neutral',
        uncertain: true,
      };

    case 'NEEDS_REVIEW':
    default:
      return {
        headline: 'Location needs review',
        detail: facts,
        tone: 'warn',
        uncertain: true,
      };
  }
}
