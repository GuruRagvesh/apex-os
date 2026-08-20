import { PunchPhotoService, MAX_PHOTO_BYTES, PHOTO_TTL_MINUTES } from '../../src/modules/platform/attendance/punch/punch-photo.service';
import { PunchEvidenceService } from '../../src/modules/platform/attendance/punch/punch-evidence.service';
import { PunchPhotoController } from '../../src/modules/platform/attendance/punch/punch-photo.controller';
import { PunchEvidenceController } from '../../src/modules/platform/attendance/punch/punch-evidence.controller';
import {
  PunchContextInvariantError,
  PunchFeatureDisabledError,
  PunchIdempotencyConflictError,
  PunchNotApplicableError,
  PunchPhotoRequiredError,
  PunchPhotoValidationError,
} from '../../src/modules/platform/attendance/punch/punch-evidence.types';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// Real TVAService and real byte validation. Prisma, storage, settings, audit
// and the BL-5 resolver are mocked. No database, no network.

const PUNE = { latitude: 18.5204, longitude: 73.8567 };

const jpeg = (n = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]);
const png = (n = 64) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]);
const webp = (n = 64) =>
  Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(n)]);
const svg = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(32)]);

const file = (buffer: Buffer, mimetype: string) => ({ buffer, mimetype, size: buffer.length });

// PE-4: the punch composes the workday engine inside one transaction.
function makeWorkdayMock() {
  return {
    startWorkInTransaction: jest.fn().mockResolvedValue({
      session: { id: 'ws-1', userId: 'emp-1' },
      wasAutoClosed: false,
    }),
    afterWorkStarted: jest.fn().mockResolvedValue(undefined),
    finalizeWorkSessionInTransaction: jest.fn().mockResolvedValue({
      session: { id: 'ws-1' },
      totalWorkMinutes: 480,
      totalBreakMinutes: 30,
      didClose: true,
      userId: 'emp-1',
    }),
    afterWorkSessionFinalized: jest.fn().mockResolvedValue(undefined),
    markUserLoggedOut: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function photoRig(opts: { enabled?: boolean; configured?: boolean } = {}) {
  const created: any[] = [];
  const prisma: any = {
    $transaction: jest.fn((fn: any) => fn(prisma)),
    attendancePunchPhoto: {
      create: jest.fn(({ data }: any) => {
        const row = { id: 'photo-1', ...data };
        created.push(row);
        return Promise.resolve(row);
      }),
    },
    attendancePunchEvidence: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const settings = {
    get: jest.fn().mockResolvedValue({ punchEvidenceEnabled: opts.enabled !== false }),
  };
  const storage = {
    isConfigured: jest.fn(() => opts.configured !== false),
    upload: jest.fn().mockResolvedValue('cloudinary:authenticated:image:apex/attendance/x:jpg'),
    signedUrl: jest.fn(() => 'https://res.cloudinary.com/signed?sig=abc&expires=123'),
  };
  const workday = makeWorkdayMock();
  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  return {
    service: new PunchPhotoService(prisma, tva, settings as any, storage as any),
    prisma, storage, created,
  };
}

describe('PunchPhotoService (PE-3)', () => {
  describe('accepted formats', () => {
    it.each([
      ['1. JPEG', jpeg(), 'image/jpeg'],
      ['2. PNG', png(), 'image/png'],
      ['3. WebP', webp(), 'image/webp'],
    ])('%s is accepted', async (_l, buf, mime) => {
      const { service, created } = photoRig();
      await service.upload('emp-1', file(buf as Buffer, mime as string));
      expect(created).toHaveLength(1);
      expect(created[0].mimeType).toBe(mime);
    });
  });

  describe('rejected content', () => {
    it('4. SVG is rejected — it is markup and can carry script', async () => {
      const { service, storage } = photoRig();
      await expect(
        service.upload('emp-1', file(svg(), 'image/svg+xml')),
      ).rejects.toBeInstanceOf(PunchPhotoValidationError);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('5. PDF is rejected', async () => {
      const { service } = photoRig();
      await expect(service.upload('emp-1', file(pdf(), 'application/pdf'))).rejects.toBeInstanceOf(
        PunchPhotoValidationError,
      );
    });

    it('6. bytes that do not match the declared MIME are rejected', async () => {
      const { service, storage } = photoRig();
      // Claims JPEG, actually a PDF.
      await expect(
        service.upload('emp-1', file(pdf(), 'image/jpeg')),
      ).rejects.toThrow(/does not match its declared type/);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('6b. an SVG relabelled as PNG is still rejected', async () => {
      const { service } = photoRig();
      await expect(service.upload('emp-1', file(svg(), 'image/png'))).rejects.toThrow(
        /does not match its declared type/,
      );
    });

    it('7. an over-size image is rejected', async () => {
      const { service, storage } = photoRig();
      const big = Buffer.concat([jpeg(), Buffer.alloc(MAX_PHOTO_BYTES)]);
      await expect(service.upload('emp-1', file(big, 'image/jpeg'))).rejects.toThrow(/5 MB/);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('an empty upload is rejected', async () => {
      const { service } = photoRig();
      await expect(
        service.upload('emp-1', file(Buffer.alloc(0), 'image/jpeg')),
      ).rejects.toBeInstanceOf(PunchPhotoValidationError);
    });
  });

  describe('server authority', () => {
    it('8/9. the owner is the JWT subject; a body userId is never read', async () => {
      const { service, created } = photoRig();
      await service.upload('emp-1', {
        ...file(jpeg(), 'image/jpeg'),
        userId: 'emp-EVIL',
      } as any);
      expect(created[0].userId).toBe('emp-1');
    });

    it('10/11. SHA-256 is computed from the received bytes; a client hash is ignored', async () => {
      const { service, created } = photoRig();
      const buf = jpeg();
      await service.upload('emp-1', { ...file(buf, 'image/jpeg'), sha256: 'forged' } as any);
      const { createHash } = require('crypto');
      expect(created[0].sha256).toBe(createHash('sha256').update(buf).digest('hex'));
      expect(created[0].sha256).not.toBe('forged');
    });

    it('identical bytes hash identically; a single changed byte does not', async () => {
      const a = photoRig();
      await a.service.upload('emp-1', file(jpeg(), 'image/jpeg'));
      const b = photoRig();
      await b.service.upload('emp-1', file(jpeg(), 'image/jpeg'));
      expect(a.created[0].sha256).toBe(b.created[0].sha256);

      const c = photoRig();
      const altered = jpeg();
      altered[10] = 0x7f;
      await c.service.upload('emp-1', file(altered, 'image/jpeg'));
      expect(c.created[0].sha256).not.toBe(a.created[0].sha256);
    });

    it('12/13. the object key comes from storage; a submitted URL is never used', async () => {
      const { service, created } = photoRig();
      await service.upload('emp-1', {
        ...file(jpeg(), 'image/jpeg'),
        objectKey: 'https://evil.example/pic.jpg',
        photoUrl: 'https://evil.example/pic.jpg',
      } as any);
      expect(created[0].objectKey).toBe('cloudinary:authenticated:image:apex/attendance/x:jpg');
      expect(created[0].objectKey).not.toContain('evil.example');
    });

    it('uploads privately, never publicly, and strips camera metadata', async () => {
      const { service, storage } = photoRig();
      await service.upload('emp-1', file(jpeg(), 'image/jpeg'));
      expect(storage.upload).toHaveBeenCalledWith('emp-1', expect.any(Buffer), 'image/jpeg');
    });

    it('14. the asset is given a short expiry', async () => {
      const { service, created } = photoRig();
      await service.upload('emp-1', file(jpeg(), 'image/jpeg'));
      const ttl = created[0].expiresAt.getTime() - created[0].receivedAt.getTime();
      expect(ttl).toBe(PHOTO_TTL_MINUTES * 60_000);
    });

    it('31. the feature flag OFF prevents upload and storage', async () => {
      const { service, storage, prisma } = photoRig({ enabled: false });
      await expect(service.upload('emp-1', file(jpeg(), 'image/jpeg'))).rejects.toBeInstanceOf(
        PunchFeatureDisabledError,
      );
      expect(storage.upload).not.toHaveBeenCalled();
      expect(prisma.attendancePunchPhoto.create).not.toHaveBeenCalled();
    });

    it('never stores bytes or base64 in the database row', async () => {
      const { service, created } = photoRig();
      await service.upload('emp-1', file(jpeg(), 'image/jpeg'));
      const serialised = JSON.stringify(created[0]);
      expect(serialised).not.toContain('base64');
      expect(created[0]).not.toHaveProperty('buffer');
      expect(created[0]).not.toHaveProperty('data');
    });
  });

  describe('photo viewing authorization', () => {
    it('32. an employee can view their own punch photo', async () => {
      const { service, prisma, storage } = photoRig();
      prisma.attendancePunchEvidence.findFirst.mockResolvedValue({
        photoObjectKey: 'cloudinary:authenticated:image:x:jpg',
      });
      const url = await service.signedUrlForOwnEvidence('emp-1', 'ev-1');
      expect(prisma.attendancePunchEvidence.findFirst.mock.calls[0][0].where).toEqual({
        id: 'ev-1',
        userId: 'emp-1',
      });
      expect(storage.signedUrl).toHaveBeenCalled();
      expect(url).toContain('sig=');
    });

    it('33. another employee gets nothing back', async () => {
      const { service, prisma } = photoRig();
      // Scoped by userId in the query, so a foreign evidence id simply misses.
      prisma.attendancePunchEvidence.findFirst.mockResolvedValue(null);
      expect(await service.signedUrlForOwnEvidence('emp-2', 'ev-1')).toBeNull();
    });

    it('34. viewing goes through a signed URL, never a stored public link', async () => {
      const { service, prisma, storage } = photoRig();
      prisma.attendancePunchEvidence.findFirst.mockResolvedValue({
        photoObjectKey: 'cloudinary:authenticated:image:x:jpg',
      });
      const url = await service.signedUrlForOwnEvidence('emp-1', 'ev-1');
      expect(storage.signedUrl).toHaveBeenCalledWith('cloudinary:authenticated:image:x:jpg');
      expect(url).not.toBe('cloudinary:authenticated:image:x:jpg');
    });
  });
});

// ── Punch integration ────────────────────────────────────────────────────────

const REQUIRED_CONTEXT = {
  attendanceApplicability: 'REQUIRED',
  blockingReasons: [],
  resolverVersion: 1,
  attendancePolicy: { geoFenceEnabled: false },
  sources: {
    employeeProfileId: 'prof-1',
    shiftPolicyId: 'shift-1',
    shiftPolicyVersion: 2,
    attendancePolicyId: 'ap-1',
    attendancePolicyVersion: 3,
    assignedAttendanceLocationId: null,
  },
};

const FRESH_PHOTO = {
  id: 'photo-1',
  userId: 'emp-1',
  objectKey: 'cloudinary:authenticated:image:x:jpg',
  sha256: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 5 * 60_000),
  punchEvidence: null,
};

const PUNCH = {
  type: 'PUNCH_IN' as const,
  idempotencyKey: 'idem-1',
  ...PUNE,
  accuracyMeters: 12,
  photoAssetId: 'photo-1',
};

function punchRig(opts: { context?: any; photo?: any; existing?: any } = {}) {
  const created: any[] = [];
  const prisma: any = {
    $transaction: jest.fn((fn: any) => fn(prisma)),
    attendancePunchEvidence: {
      findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
      create: jest.fn(({ data }: any) => {
        const row = { id: 'ev-1', ...data };
        created.push(row);
        return Promise.resolve(row);
      }),
    },
    attendancePunchPhoto: {
      findUnique: jest.fn().mockResolvedValue('photo' in opts ? opts.photo : FRESH_PHOTO),
    },
    attendanceLocation: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    workSession: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn()},
    dailyAttendance: { create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  };
  const settings = { get: jest.fn().mockResolvedValue({ punchEvidenceEnabled: true }) };
  const eventLogger = { log: jest.fn().mockResolvedValue(undefined) };
  const dailyContext = {
    resolveDailyContext: jest.fn().mockResolvedValue(opts.context ?? REQUIRED_CONTEXT),
  };
  const workday = makeWorkdayMock();
  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  return {
    workday,
    service: new PunchEvidenceService(prisma, tva, settings as any, eventLogger as any, dailyContext as any, workday),
    prisma, created, eventLogger,
  };
}

describe('Punch requires a live photo (PE-3)', () => {
  it('15. a valid unexpired own asset attaches to the punch', async () => {
    const { service, created } = punchRig();
    await service.submit('emp-1', PUNCH);
    expect(created[0].photoAssetId).toBe('photo-1');
    expect(created[0].photoVerification).toBe('CAPTURED');
  });

  it('16. a punch with no photo is rejected', async () => {
    const { service, prisma } = punchRig();
    const { photoAssetId, ...noPhoto } = PUNCH;
    await expect(service.submit('emp-1', noPhoto)).rejects.toMatchObject({
      rejection: 'PHOTO_REQUIRED',
    });
    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
  });

  it('17. an expired photo is rejected', async () => {
    const { service, prisma } = punchRig({
      photo: { ...FRESH_PHOTO, expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(service.submit('emp-1', PUNCH)).rejects.toMatchObject({
      rejection: 'PHOTO_EXPIRED',
    });
    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
  });

  it('18. another user\'s photo is rejected', async () => {
    const { service, prisma } = punchRig({ photo: { ...FRESH_PHOTO, userId: 'emp-2' } });
    await expect(service.submit('emp-1', PUNCH)).rejects.toMatchObject({
      rejection: 'PHOTO_NOT_FOUND',
    });
    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
  });

  it('18b. a nonexistent asset gets the same answer as a foreign one', async () => {
    const missing = punchRig({ photo: null });
    await expect(missing.service.submit('emp-1', PUNCH)).rejects.toMatchObject({
      rejection: 'PHOTO_NOT_FOUND',
    });
  });

  it('19. an already-used photo is rejected', async () => {
    const { service, prisma } = punchRig({
      photo: { ...FRESH_PHOTO, punchEvidence: { id: 'ev-other' } },
    });
    await expect(service.submit('emp-1', PUNCH)).rejects.toMatchObject({
      rejection: 'PHOTO_ALREADY_USED',
    });
    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
  });

  it('23/24. the initial INSERT carries CAPTURED, the object key and the hash', async () => {
    const { service, created } = punchRig();
    await service.submit('emp-1', PUNCH);
    expect(created[0]).toMatchObject({
      photoVerification: 'CAPTURED',
      photoAssetId: 'photo-1',
      photoObjectKey: 'cloudinary:authenticated:image:x:jpg',
      photoHash: 'a'.repeat(64),
    });
  });

  it('25. no evidence UPDATE path exists', async () => {
    const { service, prisma } = punchRig();
    await service.submit('emp-1', PUNCH);
    expect(prisma.attendancePunchEvidence.create).toHaveBeenCalledTimes(1);
    expect((prisma.attendancePunchEvidence as any).update).toBeUndefined();
    expect((prisma.attendancePunchEvidence as any).updateMany).toBeUndefined();
  });

  it('27. a photo is required even when geofencing is disabled', async () => {
    const { service } = punchRig({
      context: { ...REQUIRED_CONTEXT, attendancePolicy: { geoFenceEnabled: false } },
    });
    const { photoAssetId, ...noPhoto } = PUNCH;
    await expect(service.submit('emp-1', noPhoto)).rejects.toBeInstanceOf(PunchPhotoRequiredError);
  });

  it.each([
    ['28. EXEMPT', 'EXEMPT'],
    ['29. NOT_EMPLOYED', 'NOT_EMPLOYED'],
    ['30. BLOCKED', 'BLOCKED'],
  ])('%s is rejected BEFORE the photo is consumed', async (_l, applicability) => {
    const { service, prisma } = punchRig({
      context: { ...REQUIRED_CONTEXT, attendanceApplicability: applicability },
    });
    await expect(service.submit('emp-1', PUNCH)).rejects.toBeInstanceOf(PunchNotApplicableError);
    expect(prisma.attendancePunchPhoto.findUnique).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
  });

  describe('idempotency ordering', () => {
    const linked = {
      id: 'ev-existing',
      type: 'PUNCH_IN',
      clientCapturedAt: null,
      latitude: PUNE.latitude,
      longitude: PUNE.longitude,
      accuracyMeters: 12,
    };

    it('21. an exact retry succeeds even though its photo is already linked', async () => {
      // The photo is consumed BY THE VERY PUNCH being retried, so a naive
      // already-used check would reject a legitimate retry. Idempotency is
      // therefore resolved first.
      const { service, prisma } = punchRig({
        existing: linked,
        photo: { ...FRESH_PHOTO, punchEvidence: { id: 'ev-existing' } },
      });
      const ev = await service.submit('emp-1', PUNCH);
      expect(ev.id).toBe('ev-existing');
      expect(prisma.attendancePunchPhoto.findUnique).not.toHaveBeenCalled();
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('22. a conflicting retry still rejects', async () => {
      const { service } = punchRig({ existing: linked });
      await expect(
        service.submit('emp-1', { ...PUNCH, accuracyMeters: 99 }),
      ).rejects.toBeInstanceOf(PunchIdempotencyConflictError);
    });
  });

  describe('PE-2 invariant hardening', () => {
    it('REQUIRED with a null attendancePolicy throws instead of downgrading', async () => {
      const { service, prisma } = punchRig({
        context: { ...REQUIRED_CONTEXT, attendancePolicy: null },
      });
      await expect(service.submit('emp-1', PUNCH)).rejects.toBeInstanceOf(
        PunchContextInvariantError,
      );
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('it is not silently treated as NOT_ENFORCED', async () => {
      const { service, created } = punchRig({
        context: { ...REQUIRED_CONTEXT, attendancePolicy: null },
      });
      await expect(service.submit('emp-1', PUNCH)).rejects.toThrow(/invariant violation/);
      expect(created).toHaveLength(0);
    });
  });

  describe('26. PE-2 geofence behaviour is unchanged', () => {
    it('enforcement on + at the office still verifies', async () => {
      const rig = punchRig({
        context: {
          ...REQUIRED_CONTEXT,
          attendancePolicy: { geoFenceEnabled: true },
          sources: { ...REQUIRED_CONTEXT.sources, assignedAttendanceLocationId: 'loc-1' },
        },
      });
      rig.prisma.attendanceLocation.findUnique.mockResolvedValue({
        id: 'loc-1', ...PUNE, radiusMeters: 150, minimumAccuracyMeters: 100, isActive: true,
      });
      await rig.service.submit('emp-1', PUNCH);
      expect(rig.created[0].locationVerification).toBe('VERIFIED');
      expect(rig.created[0].photoVerification).toBe('CAPTURED');
    });

    it('enforcement off still records NOT_ENFORCED alongside CAPTURED', async () => {
      const { service, created } = punchRig();
      await service.submit('emp-1', PUNCH);
      expect(created[0].locationVerification).toBe('NOT_ENFORCED');
      expect(created[0].photoVerification).toBe('CAPTURED');
    });
  });

  it('35. audit carries no photo bytes, storage reference, signed URL or hash', async () => {
    const { service, eventLogger } = punchRig();
    await service.submit('emp-1', PUNCH);
    const meta = eventLogger.log.mock.calls[0][0].metadata;
    expect(meta.photoVerification).toBe('CAPTURED');
    for (const banned of ['photoObjectKey', 'photoHash', 'photoUrl', 'signedUrl', 'latitude', 'longitude']) {
      expect(meta).not.toHaveProperty(banned);
    }
    const serialised = JSON.stringify(meta);
    expect(serialised).not.toContain('cloudinary');
    expect(serialised).not.toContain('a'.repeat(64));
  });

  it('the photo API surface is upload-only, with no list or delete', () => {
    expect(Object.getOwnPropertyNames(PunchPhotoController.prototype).sort()).toEqual([
      'constructor',
      'upload',
    ]);
    expect(Object.getOwnPropertyNames(PunchEvidenceController.prototype).sort()).toEqual([
      'constructor',
      'listMine',
      'ownPhoto',
      // PE-4 added a read-only feature-flag probe so the client can leave the
      // legacy workday controls alone when punching is off. Still no mutation
      // route beyond submit.
      'status',
      'submit',
    ]);
  });
});
