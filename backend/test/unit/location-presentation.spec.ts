import {
  formatAccuracy,
  formatDistance,
  presentLocation,
} from '../../../frontend/components/attendance/location-presentation';

// GPS accuracy and distance-from-site are different measurements, and the one
// way this UI can mislead badly is by presenting one as the other: "±111 m"
// read as "111 m from the office" turns an ordinary laptop Wi-Fi fix into an
// apparent policy breach. These tests pin them apart.
//
// The verdict itself is always the server's. Nothing here re-decides whether a
// punch was inside a location.

const ev = (over: Partial<Parameters<typeof presentLocation>[0]> = {}) =>
  ({
    locationVerification: 'VERIFIED',
    locationName: 'Technols Main Office',
    distanceFromLocationMeters: 47,
    accuracyMeters: 18,
    geofenceRadiusMeters: 150,
    ...over,
  }) as any;

describe('accuracy and distance are never interchangeable', () => {
  it('always writes accuracy with a ± sign', () => {
    expect(formatAccuracy(18)).toBe('±18 m');
    expect(formatAccuracy(111)).toBe('±111 m');
  });

  it('always writes distance relative to the site', () => {
    expect(formatDistance(47, 'Technols Main Office')).toBe('47 m from Technols Main Office');
    expect(formatDistance(47, null)).toBe('47 m from assigned site');
  });

  it('renders both numbers separately when both exist', () => {
    const p = presentLocation(ev({ accuracyMeters: 111, distanceFromLocationMeters: 90 }));
    const text = `${p.headline} ${p.detail}`;

    expect(text).toContain('90 m');
    expect(text).toContain('±111 m');
    // The distance must never be stated as the accuracy figure.
    expect(text).not.toMatch(/111 m from/);
  });

  it('does not invent a distance when the site never resolved', () => {
    const p = presentLocation(ev({ distanceFromLocationMeters: null, accuracyMeters: 111 }));

    expect(p.detail).not.toMatch(/\d+ m from/);
    expect(p.detail).toContain('±111 m');
  });

  it('handles missing and non-finite values without printing NaN', () => {
    expect(formatAccuracy(null)).toBe('—');
    expect(formatAccuracy(undefined)).toBe('—');
    expect(formatAccuracy(Number.NaN)).toBe('—');
    expect(formatDistance(null)).toBe('—');
  });
});

describe('verdicts are the servers, and never overclaimed', () => {
  it('states the site by name when the server verified it', () => {
    const p = presentLocation(ev());

    expect(p.headline).toBe('Inside Technols Main Office');
    expect(p.tone).toBe('good');
    expect(p.uncertain).toBe(false);
  });

  it('does not claim verification for low accuracy', () => {
    const p = presentLocation(
      ev({ locationVerification: 'LOW_ACCURACY', accuracyMeters: 111, distanceFromLocationMeters: 90 }),
    );

    expect(p.headline).not.toMatch(/inside/i);
    expect(p.headline).toMatch(/low accuracy/i);
    expect(p.uncertain).toBe(true);
    expect(p.tone).toBe('warn');
  });

  it('does not present geofencing-off as a successful location check', () => {
    // Geofencing being switched off is not evidence the employee was inside an
    // approved location — the schema makes the same distinction deliberately.
    const p = presentLocation(ev({ locationVerification: 'NOT_ENFORCED' }));

    expect(p.headline).not.toMatch(/inside|verified|approved/i);
    expect(p.uncertain).toBe(true);
  });

  it('names the allowed radius when the punch was outside it', () => {
    const p = presentLocation(
      ev({ locationVerification: 'OUTSIDE_GEOFENCE', distanceFromLocationMeters: 320 }),
    );

    expect(p.headline).toMatch(/outside/i);
    expect(p.detail).toContain('320 m');
    expect(p.detail).toContain('allowed 150 m');
    expect(p.tone).toBe('warn');
  });

  it('distinguishes no reading from an imprecise one', () => {
    const none = presentLocation(ev({ locationVerification: 'UNAVAILABLE' }));
    const low = presentLocation(ev({ locationVerification: 'LOW_ACCURACY' }));

    expect(none.headline).toMatch(/no location/i);
    expect(low.headline).toMatch(/captured/i);
    expect(none.headline).not.toBe(low.headline);
  });

  it('treats an unknown verdict as needing review rather than as success', () => {
    const p = presentLocation(ev({ locationVerification: 'SOMETHING_NEW' as any }));

    expect(p.tone).toBe('warn');
    expect(p.uncertain).toBe(true);
    expect(p.headline).not.toMatch(/inside/i);
  });

  it('says so plainly when there is no evidence at all', () => {
    const p = presentLocation(null);

    expect(p.headline).toMatch(/no location evidence/i);
    expect(p.uncertain).toBe(true);
  });
});
