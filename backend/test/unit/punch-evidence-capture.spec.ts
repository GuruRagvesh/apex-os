import {
  ACQUISITION_PLAN,
  acquireLocation,
  failureFor,
  isStale,
  isTerminal,
  selectBestSample,
  toSample,
} from '../../../frontend/components/attendance/location-acquisition';
import {
  assessReadiness,
  judgeFrame,
  measureFrame,
  QUALITY_THRESHOLDS,
} from '../../../frontend/components/attendance/frame-quality';

// The frontend has no test runner, so these pure modules are exercised from the
// backend suite. They are dependency-free TypeScript with no React and no DOM,
// which is exactly why the rules were extracted into them: a browser-only
// implementation could not have been proven at all.

const NOW = Date.parse('2026-08-29T09:30:00.000Z');

const position = (over: any = {}) => ({
  coords: { latitude: 12.9716, longitude: 77.5946, accuracy: 20, ...over.coords },
  timestamp: over.timestamp ?? NOW,
});

const err = (code: number) => Object.assign(new Error('geo'), { code });

// ─────────────────────────────────────────────────────────────────────────────
// Location
// ─────────────────────────────────────────────────────────────────────────────

describe('a denial is terminal, everything else is transient', () => {
  it('maps the three browser codes', () => {
    expect(failureFor(1)).toBe('LOCATION_PERMISSION_DENIED');
    expect(failureFor(2)).toBe('LOCATION_UNAVAILABLE');
    expect(failureFor(3)).toBe('LOCATION_TIMEOUT');
    expect(failureFor(undefined)).toBe('LOCATION_UNAVAILABLE');
  });

  it('only a denial stops the attempts', () => {
    expect(isTerminal('LOCATION_PERMISSION_DENIED')).toBe(true);
    expect(isTerminal('LOCATION_TIMEOUT')).toBe(false);
    expect(isTerminal('LOCATION_UNAVAILABLE')).toBe(false);
    expect(isTerminal('LOCATION_STALE')).toBe(false);
  });

  it('does not retry after a denial', async () => {
    const getPosition = jest.fn(async () => {
      throw err(1);
    });
    const out = await acquireLocation(getPosition, { now: () => NOW });

    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    expect((out as any).failure).toBe('LOCATION_PERMISSION_DENIED');
  });

  it('retries a timeout with relaxed options and can then succeed', async () => {
    // The laptop case: a fresh high-accuracy fix times out, a recent one works.
    const getPosition = jest
      .fn()
      .mockRejectedValueOnce(err(3))
      .mockResolvedValueOnce(position());

    const out = await acquireLocation(getPosition, { now: () => NOW });

    expect(getPosition).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(true);
    expect(out.diagnostic.codes).toEqual(['LOCATION_TIMEOUT']);
  });

  it('retries an unavailable position too', async () => {
    const getPosition = jest
      .fn()
      .mockRejectedValueOnce(err(2))
      .mockResolvedValueOnce(position());

    expect((await acquireLocation(getPosition, { now: () => NOW })).ok).toBe(true);
  });

  it('reports the real failure when every attempt fails', async () => {
    const getPosition = jest.fn(async () => {
      throw err(2);
    });
    const out = await acquireLocation(getPosition, { now: () => NOW });

    // Never "location is switched off" — that is the message the old code gave
    // for this, and it is why the fault could not be diagnosed.
    expect((out as any).failure).toBe('LOCATION_UNAVAILABLE');
    expect(out.diagnostic.attempts).toBe(ACQUISITION_PLAN.length);
    expect(out.diagnostic.codes).toEqual(['LOCATION_UNAVAILABLE', 'LOCATION_UNAVAILABLE']);
  });

  it('first attempt refuses any cached fix, second allows a bounded one', () => {
    expect(ACQUISITION_PLAN[0].maximumAge).toBe(0);
    expect(ACQUISITION_PLAN[0].enableHighAccuracy).toBe(true);
    expect(ACQUISITION_PLAN[1].maximumAge).toBeGreaterThan(0);
    // Bounded, not unlimited: an hour-old fix is not where someone is standing.
    expect(ACQUISITION_PLAN[1].maximumAge).toBeLessThanOrEqual(300_000);
  });
});

describe('staleness is judged on position.timestamp', () => {
  const sample = (ageMs: number) => ({
    latitude: 1,
    longitude: 2,
    accuracyMeters: 10,
    capturedAt: new Date(NOW - ageMs).toISOString(),
  });

  it('accepts a recent sample and rejects an old one', () => {
    expect(isStale(sample(30_000), NOW)).toBe(false);
    expect(isStale(sample(10 * 60_000), NOW)).toBe(true);
  });

  it('rejects a timestamp from the future as a broken clock', () => {
    expect(isStale({ ...sample(0), capturedAt: new Date(NOW + 600_000).toISOString() }, NOW)).toBe(
      true,
    );
  });

  it('rejects an unparseable timestamp rather than trusting it', () => {
    expect(isStale({ ...sample(0), capturedAt: 'not-a-date' }, NOW)).toBe(true);
  });

  it('discards a stale sample during acquisition and says so', async () => {
    const getPosition = jest.fn(async () => position({ timestamp: NOW - 10 * 60_000 }));
    const out = await acquireLocation(getPosition, { now: () => NOW });

    expect(out.ok).toBe(false);
    expect((out as any).failure).toBe('LOCATION_STALE');
    expect(out.diagnostic.staleDiscarded).toBe(ACQUISITION_PLAN.length);
  });
});

describe('sample selection', () => {
  const s = (accuracy: number | null, ageMs = 0) => ({
    latitude: 1,
    longitude: 2,
    accuracyMeters: accuracy,
    capturedAt: new Date(NOW - ageMs).toISOString(),
  });

  it('prefers the most precise fresh sample', () => {
    expect(selectBestSample([s(50), s(8), s(30)], NOW)!.accuracyMeters).toBe(8);
  });

  it('ignores stale samples however precise', () => {
    expect(selectBestSample([s(2, 10 * 60_000), s(80)], NOW)!.accuracyMeters).toBe(80);
  });

  it('keeps an unmeasured sample only when nothing better exists', () => {
    expect(selectBestSample([s(null)], NOW)).not.toBeNull();
    expect(selectBestSample([s(null), s(40)], NOW)!.accuracyMeters).toBe(40);
  });

  it('returns null when every sample is stale', () => {
    expect(selectBestSample([s(5, 10 * 60_000)], NOW)).toBeNull();
  });

  it('never invents an accuracy the device did not report', () => {
    expect(toSample(position({ coords: { accuracy: undefined } }))!.accuracyMeters).toBeNull();
  });

  it('refuses a position with no usable coordinates', () => {
    expect(toSample({ coords: { latitude: NaN, longitude: 1 }, timestamp: NOW })).toBeNull();
    expect(toSample(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────────────────────────────────────

const live = [{ readyState: 'live' }];
const video = (over: any = {}) => ({
  videoWidth: 1280,
  videoHeight: 720,
  readyState: 4,
  paused: false,
  ended: false,
  ...over,
});

describe('camera readiness fails closed', () => {
  it('accepts a genuinely live, playing stream', () => {
    expect(assessReadiness(video(), live)).toBe('READY');
  });

  it.each([
    ['no stream', video(), null, 'NO_STREAM'],
    ['no video element', null, live, 'NO_STREAM'],
    ['ended track', video(), [{ readyState: 'ended' }], 'TRACK_ENDED'],
    ['ended video', video({ ended: true }), live, 'TRACK_ENDED'],
    ['paused', video({ paused: true }), live, 'NOT_PLAYING'],
    ['no frame data', video({ readyState: 1 }), live, 'NO_FRAME_DATA'],
    ['zero width', video({ videoWidth: 0 }), live, 'ZERO_DIMENSIONS'],
    ['zero height', video({ videoHeight: 0 }), live, 'ZERO_DIMENSIONS'],
  ])('rejects %s', (_label, v, tracks, expected) => {
    expect(assessReadiness(v as any, tracks as any)).toBe(expected);
  });

  it('treats zero dimensions as failure, never as a default size', () => {
    // `videoWidth || 1280` turned "no frame" into a full-size black JPEG that
    // was accepted as attendance evidence. This is the rule that replaced it.
    expect(assessReadiness(video({ videoWidth: 0, videoHeight: 0 }), live)).toBe(
      'ZERO_DIMENSIONS',
    );
  });
});

describe('frame quality', () => {
  /** Builds RGBA pixels from a per-pixel grey function. */
  const frame = (w: number, h: number, grey: (x: number, y: number) => number) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = Math.max(0, Math.min(255, grey(x, y)));
        px[i] = px[i + 1] = px[i + 2] = v;
        px[i + 3] = 255;
      }
    }
    return px;
  };

  const judge = (w: number, h: number, grey: (x: number, y: number) => number) =>
    judgeFrame(measureFrame(frame(w, h, grey), w, h));

  it('rejects a black frame — the covered-lens case', () => {
    expect(judge(48, 48, () => 0)).toBe('BLANK');
  });

  it('rejects a uniform grey frame with no content', () => {
    expect(judge(48, 48, () => 128)).toBe('BLANK');
  });

  it('rejects a blown-out white frame', () => {
    expect(judge(48, 48, () => 255)).toBe('BLANK');
  });

  it('rejects a frame that is detailed but far too dark', () => {
    // Structure present, but nothing a person could be recognised in.
    expect(judge(48, 48, (x, y) => ((x + y) % 2 === 0 ? 0 : 14))).toBe('TOO_DARK');
  });

  it('rejects a soft gradient as out of focus', () => {
    expect(judge(48, 48, (x) => 60 + x * 2)).toBe('TOO_BLURRY');
  });

  it('accepts a sharp, well-lit, detailed frame', () => {
    expect(judge(48, 48, (x, y) => (((x >> 2) + (y >> 2)) % 2 === 0 ? 70 : 200))).toBe('OK');
  });

  it('refuses to judge a frame it cannot read', () => {
    expect(judgeFrame(null)).toBe('UNREADABLE');
    expect(measureFrame(new Uint8ClampedArray(4), 40, 40)).toBeNull();
    expect(measureFrame(new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });

  it('is permissive enough not to refuse an ordinary dim office', () => {
    // A gate that rejects real punches pushes people to the manual path for
    // no reason, which is worse than no gate.
    expect(QUALITY_THRESHOLDS.minBrightness).toBeLessThanOrEqual(25);
    expect(judge(48, 48, (x, y) => (((x >> 2) + (y >> 2)) % 2 === 0 ? 40 : 120))).toBe('OK');
  });
});
