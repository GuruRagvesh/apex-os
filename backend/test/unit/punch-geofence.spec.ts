import { evaluateGeofence, haversineMeters } from '../../src/modules/platform/attendance/punch/geofence';
import { PunchEvidenceService } from '../../src/modules/platform/attendance/punch/punch-evidence.service';
import {
  PunchIdempotencyConflictError,
  PunchFeatureDisabledError,
  PunchLocationConfigurationError,
  PunchLocationRequiredError,
  PunchValidationError,
} from '../../src/modules/platform/attendance/punch/punch-evidence.types';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// Real TVAService and the real geofence maths. Prisma, settings, audit and the
// BL-5 resolver are mocked. No database.
//
// Coordinates are real Pune values rather than toy 0,0 pairs, so the distance
// maths is exercised at the latitude the company actually operates at.

const PUNE_OFFICE = { latitude: 18.5204, longitude: 73.8567 };

const LOCATION = {
  id: 'loc-pune',
  name: 'Pune Office',
  ...PUNE_OFFICE,
  radiusMeters: 150,
  minimumAccuracyMeters: 100,
  isActive: true,
};

const REQUIRED_CONTEXT = {
  attendanceApplicability: 'REQUIRED',
  blockingReasons: [],
  resolverVersion: 1,
  // geoFenceEnabled governs ENFORCEMENT only; GPS capture is mandatory either
  // way. Default here is enforcement ON, matching the office policy.
  attendancePolicy: { geoFenceEnabled: true },
  sources: {
    employeeProfileId: 'prof-1',
    shiftPolicyId: 'shift-1',
    shiftPolicyVersion: 2,
    attendancePolicyId: 'ap-1',
    attendancePolicyVersion: 3,
    assignedAttendanceLocationId: 'loc-pune',
  },
};


// PE-3 made a live photo mandatory for every punch, so these fixtures now stage
// one. Everything else about these suites is unchanged.
const FRESH_PHOTO = {
  id: 'photo-1',
  userId: 'emp-1',
  objectKey: 'cloudinary:authenticated:image:x:jpg',
  sha256: 'a'.repeat(64),
  // Fixed and far future: several tests pin tva.now() to an explicit instant,
  // and a relative expiry would fall behind those mocked clocks.
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  punchEvidence: null,
};

const AT_OFFICE = {
  type: 'PUNCH_IN' as const,
  idempotencyKey: 'idem-1',
  latitude: PUNE_OFFICE.latitude,
  longitude: PUNE_OFFICE.longitude,
  accuracyMeters: 12,
  photoAssetId: 'photo-1',
};

/** Moves north by a given number of metres. 1 deg latitude ~ 111.2 km. */
const northOf = (m: number) => ({
  latitude: PUNE_OFFICE.latitude + m / 111_195,
  longitude: PUNE_OFFICE.longitude,
});

function build(
  opts: {
    enabled?: boolean;
    context?: any;
    existing?: any;
    locationById?: Record<string, any>;
    activeLocations?: any[];
  } = {},
) {
  const created: any[] = [];
  const prisma: any = {
    attendancePunchEvidence: {
      findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: any) => {
        const row = { id: 'ev-1', ...data };
        created.push(row);
        return Promise.resolve(row);
      }),
    },
    attendancePunchPhoto: {
      findUnique: jest.fn(() => Promise.resolve({ ...FRESH_PHOTO })),
    },
    attendanceLocation: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve((opts.locationById ?? { 'loc-pune': LOCATION })[where.id] ?? null),
      ),
      findMany: jest.fn(() => Promise.resolve(opts.activeLocations ?? [LOCATION])),
    },
    workSession: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    breakLog: { create: jest.fn(), update: jest.fn() },
    leaveRequest: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    dailyAttendance: { create: jest.fn(), update: jest.fn(), upsert: jest.fn(), findFirst: jest.fn() },
  };
  const settings = {
    get: jest.fn().mockResolvedValue({ punchEvidenceEnabled: opts.enabled !== false }),
  };
  const eventLogger = { log: jest.fn().mockResolvedValue(undefined) };
  const dailyContext = {
    resolveDailyContext: jest.fn().mockResolvedValue(opts.context ?? REQUIRED_CONTEXT),
  };
  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  const service = new PunchEvidenceService(
    prisma, tva, settings as any, eventLogger as any, dailyContext as any,
  );
  return { service, prisma, created, eventLogger };
}

describe('Geofence maths (PE-2)', () => {
  it('1. the exact office coordinate is zero metres away', () => {
    expect(haversineMeters(PUNE_OFFICE, PUNE_OFFICE)).toBeCloseTo(0, 6);
  });

  it('computes a realistic Pune-scale distance', () => {
    // Pune office -> Shivajinagar, roughly 2 km.
    const d = haversineMeters(PUNE_OFFICE, { latitude: 18.5308, longitude: 73.8478 });
    expect(d).toBeGreaterThan(1200);
    expect(d).toBeLessThan(2200);
  });

  it('is symmetric', () => {
    const a = PUNE_OFFICE;
    const b = { latitude: 18.5308, longitude: 73.8478 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('a 100 m northward offset measures about 100 m', () => {
    expect(haversineMeters(PUNE_OFFICE, northOf(100))).toBeCloseTo(100, 0);
  });

  it.each([
    ['latitude out of range', { latitude: 91, longitude: 0 }],
    ['longitude out of range', { latitude: 0, longitude: 181 }],
    ['non-finite latitude', { latitude: Number.NaN, longitude: 0 }],
    ['infinite longitude', { latitude: 0, longitude: Number.POSITIVE_INFINITY }],
  ])('throws rather than returning NaN for %s', (_l, pt) => {
    expect(() => haversineMeters(pt as any, PUNE_OFFICE)).toThrow(/Invalid/);
  });

  const cfg = { ...PUNE_OFFICE, radiusMeters: 150, minimumAccuracyMeters: 100 };

  it('1b. exact office coordinate => VERIFIED', () => {
    expect(evaluateGeofence({ ...PUNE_OFFICE, accuracyMeters: 10 }, cfg).verdict).toBe('VERIFIED');
  });

  it('2. within radius => VERIFIED', () => {
    expect(evaluateGeofence({ ...northOf(100), accuracyMeters: 10 }, cfg).verdict).toBe('VERIFIED');
  });

  it('3. exactly on the radius boundary => VERIFIED (inclusive)', () => {
    // Measured with the implementation's own maths rather than an approximate
    // metres-per-degree constant, so this tests the <= boundary exactly instead
    // of a fixture that lands a fraction of a metre either side of it.
    const point = { ...northOf(150), accuracyMeters: 10 };
    const exact = haversineMeters(point, PUNE_OFFICE);
    const d = evaluateGeofence(point, { ...cfg, radiusMeters: exact });
    expect(d.distanceMeters).toBe(exact);
    expect(d.verdict).toBe('VERIFIED');
  });

  it('3b. one metre beyond the radius => OUTSIDE_GEOFENCE', () => {
    const point = { ...northOf(150), accuracyMeters: 10 };
    const exact = haversineMeters(point, PUNE_OFFICE);
    expect(evaluateGeofence(point, { ...cfg, radiusMeters: exact - 1 }).verdict).toBe(
      'OUTSIDE_GEOFENCE',
    );
  });

  it('4. outside radius => OUTSIDE_GEOFENCE', () => {
    expect(evaluateGeofence({ ...northOf(400), accuracyMeters: 10 }, cfg).verdict).toBe(
      'OUTSIDE_GEOFENCE',
    );
  });

  it('5. accuracy worse than the threshold => LOW_ACCURACY', () => {
    expect(evaluateGeofence({ ...PUNE_OFFICE, accuracyMeters: 500 }, cfg).verdict).toBe(
      'LOW_ACCURACY',
    );
  });

  it('5b. a vague reading sitting on the office is NOT verified', () => {
    // The whole point: a 2 km error radius centred on the office proves nothing.
    const d = evaluateGeofence({ ...PUNE_OFFICE, accuracyMeters: 2000 }, cfg);
    expect(d.verdict).toBe('LOW_ACCURACY');
    expect(d.verdict).not.toBe('VERIFIED');
  });

  it('accuracy exactly at the threshold is accepted', () => {
    expect(evaluateGeofence({ ...PUNE_OFFICE, accuracyMeters: 100 }, cfg).verdict).toBe('VERIFIED');
  });

  it('missing accuracy is treated as untrustworthy, not as verified', () => {
    expect(evaluateGeofence({ ...PUNE_OFFICE }, cfg).verdict).toBe('LOW_ACCURACY');
  });

  it('no coordinates => UNAVAILABLE with no distance', () => {
    const d = evaluateGeofence({ accuracyMeters: 10 }, cfg);
    expect(d.verdict).toBe('UNAVAILABLE');
    expect(d.distanceMeters).toBeNull();
  });

  it('20. always returns the provenance needed to explain the verdict', () => {
    const d = evaluateGeofence({ ...northOf(400), accuracyMeters: 10 }, cfg);
    expect(d.radiusMeters).toBe(150);
    expect(d.accuracyThresholdMeters).toBe(100);
    expect(d.distanceMeters).toBeGreaterThan(150);
  });
});

describe('PunchEvidenceService geofence integration (PE-2)', () => {
  describe('server decides, client cannot', () => {
    it('19. distance is calculated server-side and stored', async () => {
      const { service, created } = build();
      await service.submit('emp-1', { ...AT_OFFICE, ...northOf(100) });
      expect(created[0].distanceFromLocationMeters).toBeCloseTo(100, 0);
      expect(created[0].locationVerification).toBe('VERIFIED');
    });

    it('10. a client-submitted verification result is ignored', async () => {
      const { service, created } = build();
      await service.submit('emp-1', {
        ...AT_OFFICE,
        ...northOf(400),
        locationVerification: 'VERIFIED',
        distanceFromLocationMeters: 0,
      } as any);
      expect(created[0].locationVerification).toBe('OUTSIDE_GEOFENCE');
      expect(created[0].distanceFromLocationMeters).toBeGreaterThan(150);
    });

    it('11. client-submitted office coordinates and radius are ignored', async () => {
      const { service, created } = build();
      await service.submit('emp-1', {
        ...AT_OFFICE,
        ...northOf(400),
        geofenceRadiusMeters: 100000,
        accuracyThresholdMeters: 100000,
        attendanceLocationId: 'loc-forged',
      } as any);
      expect(created[0].locationVerification).toBe('OUTSIDE_GEOFENCE');
      expect(created[0].geofenceRadiusMeters).toBe(150);
      expect(created[0].accuracyThresholdMeters).toBe(100);
      expect(created[0].attendanceLocationId).toBe('loc-pune');
    });

    it('20b. decision provenance is stored, not just the verdict', async () => {
      const { service, created } = build();
      await service.submit('emp-1', AT_OFFICE);
      expect(created[0]).toMatchObject({
        attendanceLocationId: 'loc-pune',
        geofenceRadiusMeters: 150,
        accuracyThresholdMeters: 100,
      });
      expect(created[0].distanceFromLocationMeters).not.toBeNull();
    });
  });

  describe('GPS is now required for a normal punch', () => {
    it('6. a punch with no coordinates is rejected', async () => {
      const { service, prisma } = build();
      await expect(
        service.submit('emp-1', { type: 'PUNCH_IN', idempotencyKey: 'k', accuracyMeters: 10 }),
      ).rejects.toBeInstanceOf(PunchLocationRequiredError);
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it.each([
      ['7. invalid latitude', { latitude: 91 }],
      ['8. invalid longitude', { longitude: 181 }],
      ['9. invalid accuracy', { accuracyMeters: 0 }],
    ])('%s is rejected before any write', async (_l, patch) => {
      const { service, prisma } = build();
      await expect(
        service.submit('emp-1', { ...AT_OFFICE, ...patch } as any),
      ).rejects.toBeInstanceOf(PunchValidationError);
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });
  });

  describe('location resolution follows the BL-5 integrity rule', () => {
    it('12. the assigned location is used', async () => {
      const { service, prisma, created } = build();
      await service.submit('emp-1', AT_OFFICE);
      expect(prisma.attendanceLocation.findUnique).toHaveBeenCalledWith({
        where: { id: 'loc-pune' },
      });
      expect(created[0].attendanceLocationId).toBe('loc-pune');
    });

    it('13. two employees may be judged against different locations', async () => {
      const mumbai = {
        id: 'loc-mumbai',
        name: 'Mumbai Office',
        latitude: 19.076,
        longitude: 72.8777,
        radiusMeters: 150,
        minimumAccuracyMeters: 100,
        isActive: true,
      };
      const byId = { 'loc-pune': LOCATION, 'loc-mumbai': mumbai };

      const a = build({ locationById: byId });
      await a.service.submit('emp-1', AT_OFFICE);

      const b = build({
        locationById: byId,
        context: {
          ...REQUIRED_CONTEXT,
          sources: { ...REQUIRED_CONTEXT.sources, assignedAttendanceLocationId: 'loc-mumbai' },
        },
      });
      await b.service.submit('emp-1', AT_OFFICE);

      // Same coordinates: at the Pune office, and ~120 km from Mumbai.
      expect(a.created[0].locationVerification).toBe('VERIFIED');
      expect(b.created[0].locationVerification).toBe('OUTSIDE_GEOFENCE');
      expect(b.created[0].attendanceLocationId).toBe('loc-mumbai');
    });

    it('14. no assignment + exactly one active location resolves as default', async () => {
      const { service, created } = build({
        context: {
          ...REQUIRED_CONTEXT,
          sources: { ...REQUIRED_CONTEXT.sources, assignedAttendanceLocationId: null },
        },
        activeLocations: [LOCATION],
      });
      await service.submit('emp-1', AT_OFFICE);
      expect(created[0].attendanceLocationId).toBe('loc-pune');
    });

    it('15. no assignment + zero active locations blocks with a config error', async () => {
      const { service, prisma } = build({
        context: {
          ...REQUIRED_CONTEXT,
          sources: { ...REQUIRED_CONTEXT.sources, assignedAttendanceLocationId: null },
        },
        activeLocations: [],
      });
      await expect(service.submit('emp-1', AT_OFFICE)).rejects.toMatchObject({
        reason: 'MISSING_ATTENDANCE_LOCATION',
      });
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('16. no assignment + two active locations blocks as ambiguous', async () => {
      const { service, prisma } = build({
        context: {
          ...REQUIRED_CONTEXT,
          sources: { ...REQUIRED_CONTEXT.sources, assignedAttendanceLocationId: null },
        },
        activeLocations: [LOCATION, { ...LOCATION, id: 'loc-b' }],
      });
      await expect(service.submit('emp-1', AT_OFFICE)).rejects.toMatchObject({
        reason: 'AMBIGUOUS_ATTENDANCE_LOCATION',
      });
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('16b. counts candidates with take: 2 rather than loading them all', async () => {
      const { service, prisma } = build({
        context: {
          ...REQUIRED_CONTEXT,
          sources: { ...REQUIRED_CONTEXT.sources, assignedAttendanceLocationId: null },
        },
      });
      await service.submit('emp-1', AT_OFFICE);
      expect(prisma.attendanceLocation.findMany.mock.calls[0][0].take).toBe(2);
    });

    it('17. an explicit assignment wins when several globals exist', async () => {
      const { service, created, prisma } = build({
        activeLocations: [{ ...LOCATION, id: 'x' }, { ...LOCATION, id: 'y' }],
      });
      await service.submit('emp-1', AT_OFFICE);
      expect(created[0].attendanceLocationId).toBe('loc-pune');
      expect(prisma.attendanceLocation.findMany).not.toHaveBeenCalled();
    });

    it('18. an inactive assigned location blocks rather than silently switching', async () => {
      const { service, prisma } = build({
        locationById: { 'loc-pune': { ...LOCATION, isActive: false } },
        activeLocations: [{ ...LOCATION, id: 'loc-other' }],
      });
      await expect(service.submit('emp-1', AT_OFFICE)).rejects.toBeInstanceOf(
        PunchLocationConfigurationError,
      );
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('a deleted assigned location blocks too', async () => {
      const { service } = build({ locationById: {} });
      await expect(service.submit('emp-1', AT_OFFICE)).rejects.toBeInstanceOf(
        PunchLocationConfigurationError,
      );
    });
  });

  describe('exceptions are preserved as evidence, not discarded', () => {
    it('22. an OUTSIDE_GEOFENCE punch is still written', async () => {
      const { service, created } = build();
      await service.submit('emp-1', { ...AT_OFFICE, ...northOf(500) });
      expect(created).toHaveLength(1);
      expect(created[0].locationVerification).toBe('OUTSIDE_GEOFENCE');
    });

    it('21. a LOW_ACCURACY punch is still written', async () => {
      const { service, created } = build();
      await service.submit('emp-1', { ...AT_OFFICE, accuracyMeters: 900 });
      expect(created).toHaveLength(1);
      expect(created[0].locationVerification).toBe('LOW_ACCURACY');
    });

    it('21b/22b. exception evidence is inserted ONCE and never updated', async () => {
      const { service, prisma } = build();
      await service.submit('emp-1', { ...AT_OFFICE, ...northOf(500) });
      expect(prisma.attendancePunchEvidence.create).toHaveBeenCalledTimes(1);
      expect((prisma.attendancePunchEvidence as any).update).toBeUndefined();
      expect((prisma.attendancePunchEvidence as any).updateMany).toBeUndefined();
    });

    it('an exception never becomes an attendance judgement', async () => {
      const { service, created } = build();
      await service.submit('emp-1', { ...AT_OFFICE, ...northOf(500) });
      for (const banned of ['status', 'absent', 'lwp', 'halfDay', 'leaveDeducted']) {
        expect(created[0]).not.toHaveProperty(banned);
      }
    });
  });

  describe('layer boundaries and carried-forward PE-1 guarantees', () => {
    it('23. no DailyAttendance classification', async () => {
      const { service, prisma } = build();
      await service.submit('emp-1', AT_OFFICE);
      for (const fn of Object.values(prisma.dailyAttendance)) expect(fn).not.toHaveBeenCalled();
    });

    it('24. no Leave mutation', async () => {
      const { service, prisma } = build();
      await service.submit('emp-1', AT_OFFICE);
      for (const fn of Object.values(prisma.leaveRequest)) expect(fn).not.toHaveBeenCalled();
    });

    it('25. no WorkSession mutation', async () => {
      const { service, prisma } = build();
      await service.submit('emp-1', AT_OFFICE);
      for (const fn of Object.values(prisma.workSession)) expect(fn).not.toHaveBeenCalled();
      for (const fn of Object.values(prisma.breakLog)) expect(fn).not.toHaveBeenCalled();
    });

    it('26. the feature flag OFF prevents all writes and all location reads', async () => {
      const { service, prisma } = build({ enabled: false });
      await expect(service.submit('emp-1', AT_OFFICE)).rejects.toBeInstanceOf(
        PunchFeatureDisabledError,
      );
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
      expect(prisma.attendanceLocation.findUnique).not.toHaveBeenCalled();
      expect(prisma.attendanceLocation.findMany).not.toHaveBeenCalled();
    });

    it('27. PE-1 idempotency still returns the original on retry', async () => {
      const existing = {
        id: 'ev-existing',
        type: 'PUNCH_IN',
        clientCapturedAt: null,
        latitude: AT_OFFICE.latitude,
        longitude: AT_OFFICE.longitude,
        accuracyMeters: 12,
      };
      const { service, prisma } = build({ existing });
      const ev = await service.submit('emp-1', AT_OFFICE);
      expect(ev.id).toBe('ev-existing');
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('28. a conflicting retry still rejects', async () => {
      const existing = {
        id: 'ev-existing',
        type: 'PUNCH_IN',
        clientCapturedAt: null,
        latitude: AT_OFFICE.latitude,
        longitude: AT_OFFICE.longitude,
        accuracyMeters: 12,
      };
      const { service } = build({ existing });
      await expect(
        service.submit('emp-1', { ...AT_OFFICE, accuracyMeters: 99 }),
      ).rejects.toBeInstanceOf(PunchIdempotencyConflictError);
    });

    it('29. source provenance is retained', async () => {
      const { service, created } = build();
      await service.submit('emp-1', { ...AT_OFFICE, source: 'MOBILE' });
      expect(created[0].source).toBe('MOBILE');
      expect(created[0]).toMatchObject({
        employeeProfileId: 'prof-1',
        shiftPolicyId: 'shift-1',
        attendancePolicyId: 'ap-1',
        contextResolverVersion: 1,
      });
    });

    it('30. audit carries the verdict but never the raw coordinates', async () => {
      const { service, eventLogger } = build();
      await service.submit('emp-1', AT_OFFICE);
      const meta = eventLogger.log.mock.calls[0][0].metadata;
      expect(meta.locationVerification).toBe('VERIFIED');
      expect(meta).not.toHaveProperty('latitude');
      expect(meta).not.toHaveProperty('longitude');
      const serialised = JSON.stringify(meta);
      expect(serialised).not.toContain('18.5204');
      expect(serialised).not.toContain('73.8567');
    });
  });
});

describe('geoFenceEnabled governs enforcement, never capture (PE-2 policy wiring)', () => {
  const enforced = REQUIRED_CONTEXT;
  const unenforced = {
    ...REQUIRED_CONTEXT,
    attendancePolicy: { geoFenceEnabled: false },
  };

  describe('enforcement ON', () => {
    it('inside the radius => VERIFIED', async () => {
      const { service, created } = build({ context: enforced });
      await service.submit('emp-1', AT_OFFICE);
      expect(created[0].locationVerification).toBe('VERIFIED');
    });

    it('outside the radius => OUTSIDE_GEOFENCE', async () => {
      const { service, created } = build({ context: enforced });
      await service.submit('emp-1', { ...AT_OFFICE, ...northOf(500) });
      expect(created[0].locationVerification).toBe('OUTSIDE_GEOFENCE');
    });

    it('poor accuracy => LOW_ACCURACY', async () => {
      const { service, created } = build({ context: enforced });
      await service.submit('emp-1', { ...AT_OFFICE, accuracyMeters: 900 });
      expect(created[0].locationVerification).toBe('LOW_ACCURACY');
    });

    it('missing location configuration blocks the punch', async () => {
      const { service, prisma } = build({
        context: {
          ...enforced,
          sources: { ...enforced.sources, assignedAttendanceLocationId: null },
        },
        activeLocations: [],
      });
      await expect(service.submit('emp-1', AT_OFFICE)).rejects.toBeInstanceOf(
        PunchLocationConfigurationError,
      );
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });
  });

  describe('enforcement OFF', () => {
    it('valid GPS => NOT_ENFORCED, never VERIFIED', async () => {
      const { service, created } = build({ context: unenforced });
      await service.submit('emp-1', AT_OFFICE);
      expect(created[0].locationVerification).toBe('NOT_ENFORCED');
      expect(created[0].locationVerification).not.toBe('VERIFIED');
    });

    it('zero attendance locations still succeeds', async () => {
      const { service, created } = build({
        context: {
          ...unenforced,
          sources: { ...unenforced.sources, assignedAttendanceLocationId: null },
        },
        activeLocations: [],
      });
      await service.submit('emp-1', AT_OFFICE);
      expect(created).toHaveLength(1);
      expect(created[0].locationVerification).toBe('NOT_ENFORCED');
    });

    it('multiple attendance locations still succeeds — no ambiguity block', async () => {
      const { service, created } = build({
        context: {
          ...unenforced,
          sources: { ...unenforced.sources, assignedAttendanceLocationId: null },
        },
        activeLocations: [LOCATION, { ...LOCATION, id: 'loc-b' }],
      });
      await service.submit('emp-1', AT_OFFICE);
      expect(created).toHaveLength(1);
      expect(created[0].locationVerification).toBe('NOT_ENFORCED');
    });

    it('an inactive assigned location no longer matters', async () => {
      const { service, created } = build({
        context: unenforced,
        locationById: { 'loc-pune': { ...LOCATION, isActive: false } },
      });
      await service.submit('emp-1', AT_OFFICE);
      expect(created[0].locationVerification).toBe('NOT_ENFORCED');
    });

    it('no location is resolved at all', async () => {
      const { service, prisma, created } = build({ context: unenforced });
      await service.submit('emp-1', AT_OFFICE);
      expect(prisma.attendanceLocation.findUnique).not.toHaveBeenCalled();
      expect(prisma.attendanceLocation.findMany).not.toHaveBeenCalled();
      expect(created[0].attendanceLocationId).toBeNull();
    });

    it('carries no geofence provenance, because none was applied', async () => {
      const { service, created } = build({ context: unenforced });
      await service.submit('emp-1', { ...AT_OFFICE, ...northOf(5000) });
      expect(created[0].distanceFromLocationMeters).toBeNull();
      expect(created[0].geofenceRadiusMeters).toBeNull();
      expect(created[0].accuracyThresholdMeters).toBeNull();
    });

    it('GPS is STILL required', async () => {
      const { service, prisma } = build({ context: unenforced });
      await expect(
        service.submit('emp-1', { type: 'PUNCH_IN', idempotencyKey: 'k', accuracyMeters: 10 }),
      ).rejects.toBeInstanceOf(PunchLocationRequiredError);
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it.each([
      ['latitude', { latitude: 91 }],
      ['longitude', { longitude: 181 }],
      ['accuracy', { accuracyMeters: 0 }],
    ])('still validates %s', async (_l, patch) => {
      const { service } = build({ context: unenforced });
      await expect(
        service.submit('emp-1', { ...AT_OFFICE, ...patch } as any),
      ).rejects.toBeInstanceOf(PunchValidationError);
    });

    it('still stores the submitted GPS', async () => {
      const { service, created } = build({ context: unenforced });
      await service.submit('emp-1', AT_OFFICE);
      expect(created[0].latitude).toBe(PUNE_OFFICE.latitude);
      expect(created[0].longitude).toBe(PUNE_OFFICE.longitude);
      expect(created[0].accuracyMeters).toBe(12);
    });
  });

  it('a client cannot declare NOT_ENFORCED itself', async () => {
    const { service, created } = build({ context: enforced });
    await service.submit('emp-1', {
      ...AT_OFFICE,
      ...northOf(500),
      locationVerification: 'NOT_ENFORCED',
    } as any);
    expect(created[0].locationVerification).toBe('OUTSIDE_GEOFENCE');
  });

  it('a client cannot switch enforcement off', async () => {
    const { service, created } = build({ context: enforced });
    await service.submit('emp-1', {
      ...AT_OFFICE,
      ...northOf(500),
      geoFenceEnabled: false,
    } as any);
    expect(created[0].locationVerification).toBe('OUTSIDE_GEOFENCE');
  });

  it('the policy value comes from the resolved server context', async () => {
    const { service, created } = build({
      context: { ...REQUIRED_CONTEXT, attendancePolicy: { geoFenceEnabled: false } },
    });
    await service.submit('emp-1', AT_OFFICE);
    expect(created[0].locationVerification).toBe('NOT_ENFORCED');
  });

  it('an absent attendancePolicy THROWS rather than silently downgrading', async () => {
    // Superseded by the PE-3 invariant. Treating a null policy as
    // geoFenceEnabled === false would quietly turn an office punch into
    // NOT_ENFORCED, so REQUIRED-without-a-policy is now a loud failure.
    // BL-5 should make the state unreachable; this is defence in depth.
    const { service, created } = build({
      context: { ...REQUIRED_CONTEXT, attendancePolicy: null },
    });
    await expect(service.submit('emp-1', AT_OFFICE)).rejects.toThrow(/invariant violation/);
    expect(created).toHaveLength(0);
  });
});
