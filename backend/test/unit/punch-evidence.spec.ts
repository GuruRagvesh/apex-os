import { PunchEvidenceService } from '../../src/modules/platform/attendance/punch/punch-evidence.service';
import {
  PunchFeatureDisabledError,
  PunchIdempotencyConflictError,
  PunchNotApplicableError,
  PunchValidationError,
} from '../../src/modules/platform/attendance/punch/punch-evidence.types';
import { PunchEvidenceController } from '../../src/modules/platform/attendance/punch/punch-evidence.controller';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// Real TVAService (BL-1 company-time contract). Prisma, settings, audit and the
// BL-5 context resolver are mocked. No database.

const REQUIRED_CONTEXT = {
  attendanceApplicability: 'REQUIRED',
  blockingReasons: [],
  resolverVersion: 1,
  sources: {
    employeeProfileId: 'prof-1',
    shiftPolicyId: 'shift-1',
    shiftPolicyVersion: 2,
    attendancePolicyId: 'ap-1',
    attendancePolicyVersion: 3,
  },
};

const VALID = {
  type: 'PUNCH_IN' as const,
  idempotencyKey: 'idem-1',
  clientCapturedAt: '2026-08-17T04:00:00.000Z',
  latitude: 18.52,
  longitude: 73.85,
  accuracyMeters: 12,
};

function build(opts: { enabled?: boolean; context?: any; existing?: any; now?: Date } = {}) {
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
    // Present so tests can prove PE-1 never touches them.
    workSession: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    breakLog: { create: jest.fn(), update: jest.fn() },
    dailyAttendance: { create: jest.fn(), update: jest.fn(), upsert: jest.fn(), findFirst: jest.fn() },
    attendanceEvent: { create: jest.fn() },
  };

  const settings = {
    get: jest.fn().mockResolvedValue({ punchEvidenceEnabled: opts.enabled !== false }),
  };
  const eventLogger = { log: jest.fn().mockResolvedValue(undefined) };
  const dailyContext = {
    resolveDailyContext: jest.fn().mockResolvedValue(opts.context ?? REQUIRED_CONTEXT),
  };

  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  if (opts.now) jest.spyOn(tva, 'now').mockReturnValue(opts.now);

  const service = new PunchEvidenceService(
    prisma,
    tva,
    settings as any,
    eventLogger as any,
    dailyContext as any,
  );
  return { service, prisma, settings, eventLogger, dailyContext, created, tva };
}

describe('PunchEvidenceService (PE-1)', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('creation and server authority', () => {
    it('1. an authenticated user creates PUNCH_IN evidence', async () => {
      const { service, prisma } = build();
      const ev = await service.submit('emp-1', VALID);
      expect(prisma.attendancePunchEvidence.create).toHaveBeenCalledTimes(1);
      expect(ev.type).toBe('PUNCH_IN');
      expect(ev.userId).toBe('emp-1');
    });

    it('2. the JWT subject wins; a userId in the body is never read', async () => {
      const { service, created } = build();
      await service.submit('emp-1', { ...VALID, userId: 'emp-EVIL' } as any);
      expect(created[0].userId).toBe('emp-1');
    });

    it('2b. a client-supplied businessDate or verification state is ignored', async () => {
      const { service, created } = build({ now: new Date('2026-08-17T06:00:00.000Z') });
      await service.submit('emp-1', {
        ...VALID,
        businessDate: '1999-01-01',
        locationVerification: 'VERIFIED',
        photoVerification: 'CAPTURED',
        serverOccurredAt: '1999-01-01T00:00:00.000Z',
      } as any);
      expect(created[0].businessDate.toISOString()).toBe('2026-08-17T00:00:00.000Z');
      expect(created[0].locationVerification).toBe('PENDING');
      expect(created[0].photoVerification).toBe('PENDING');
      expect(created[0].serverOccurredAt.toISOString()).toBe('2026-08-17T06:00:00.000Z');
    });

    it('3. the server determines businessDate from company time', async () => {
      const { service, created } = build({ now: new Date('2026-08-17T06:00:00.000Z') });
      await service.submit('emp-1', VALID);
      expect(created[0].businessDate.toISOString()).toBe('2026-08-17T00:00:00.000Z');
    });

    it('4. an instant past IST midnight lands on the NEXT business date', async () => {
      // 2026-08-20T19:15:00Z is 2026-08-21 00:45 IST.
      const { service, created } = build({ now: new Date('2026-08-20T19:15:00.000Z') });
      await service.submit('emp-1', VALID);
      expect(created[0].businessDate.toISOString()).toBe('2026-08-21T00:00:00.000Z');
    });

    it('5. serverOccurredAt comes from the server clock', async () => {
      const now = new Date('2026-08-17T06:30:00.000Z');
      const { service, created } = build({ now });
      await service.submit('emp-1', VALID);
      expect(created[0].serverOccurredAt).toEqual(now);
      expect(created[0].receivedAt).toEqual(now);
    });

    it('6. clientCapturedAt is retained separately from the server instant', async () => {
      const { service, created } = build({ now: new Date('2026-08-17T06:30:00.000Z') });
      await service.submit('emp-1', VALID);
      expect(created[0].clientCapturedAt.toISOString()).toBe('2026-08-17T04:00:00.000Z');
      expect(created[0].clientCapturedAt).not.toEqual(created[0].serverOccurredAt);
    });
  });

  describe('context gate', () => {
    it('7. REQUIRED is accepted', async () => {
      const { service, prisma } = build();
      await service.submit('emp-1', VALID);
      expect(prisma.attendancePunchEvidence.create).toHaveBeenCalled();
    });

    it('8. EXEMPT is rejected', async () => {
      const { service, prisma } = build({
        context: { ...REQUIRED_CONTEXT, attendanceApplicability: 'EXEMPT' },
      });
      await expect(service.submit('emp-1', VALID)).rejects.toBeInstanceOf(PunchNotApplicableError);
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('9. NOT_EMPLOYED is rejected', async () => {
      const { service, prisma } = build({
        context: { ...REQUIRED_CONTEXT, attendanceApplicability: 'NOT_EMPLOYED' },
      });
      await expect(service.submit('emp-1', VALID)).rejects.toBeInstanceOf(PunchNotApplicableError);
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('10. BLOCKED is rejected and carries the configuration reason', async () => {
      const { service } = build({
        context: {
          ...REQUIRED_CONTEXT,
          attendanceApplicability: 'BLOCKED',
          blockingReasons: ['AMBIGUOUS_HOLIDAY_CALENDAR'],
        },
      });
      await expect(service.submit('emp-1', VALID)).rejects.toMatchObject({
        applicability: 'BLOCKED',
        blockingReasons: ['AMBIGUOUS_HOLIDAY_CALENDAR'],
      });
      await expect(service.submit('emp-1', VALID)).rejects.toThrow(/HR review is required/);
    });

    it('resolves the context for the JWT subject at the server instant', async () => {
      const now = new Date('2026-08-17T06:00:00.000Z');
      const { service, dailyContext } = build({ now });
      await service.submit('emp-1', VALID);
      expect(dailyContext.resolveDailyContext).toHaveBeenCalledWith('emp-1', now);
    });
  });

  describe('GPS validation — stored, not judged', () => {
    it.each([
      ['11. latitude below -90', { latitude: -90.1 }],
      ['12. latitude above 90', { latitude: 90.1 }],
      ['13. longitude below -180', { longitude: -180.1 }],
      ['14. longitude above 180', { longitude: 180.1 }],
      ['15. zero accuracy', { accuracyMeters: 0 }],
      ['15b. negative accuracy', { accuracyMeters: -5 }],
      ['15c. non-finite latitude', { latitude: Number.NaN }],
      ['15d. infinite longitude', { longitude: Number.POSITIVE_INFINITY }],
    ])('%s is rejected', async (_label, patch) => {
      const { service, prisma } = build();
      await expect(service.submit('emp-1', { ...VALID, ...patch } as any)).rejects.toBeInstanceOf(
        PunchValidationError,
      );
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('boundary values are accepted', async () => {
      const { service } = build();
      await expect(
        service.submit('emp-1', { ...VALID, latitude: -90, longitude: 180, accuracyMeters: 0.1 }),
      ).resolves.toBeDefined();
    });

    it('stores coordinates and leaves the verdict to PE-2', async () => {
      const { service, created } = build();
      await service.submit('emp-1', VALID);
      expect(created[0].latitude).toBe(18.52);
      expect(created[0].longitude).toBe(73.85);
      expect(created[0].accuracyMeters).toBe(12);
      expect(created[0].locationVerification).toBe('PENDING');
    });

    it('a punch with no GPS at all is still valid evidence', async () => {
      const { service, created } = build();
      await service.submit('emp-1', { type: 'PUNCH_IN', idempotencyKey: 'k' });
      expect(created[0].latitude).toBeNull();
      expect(created[0].locationVerification).toBe('PENDING');
    });
  });

  describe('idempotency', () => {
    it('16. a retry with the same key returns the SAME evidence, without writing', async () => {
      const existing = {
        id: 'ev-existing',
        type: 'PUNCH_IN',
        clientCapturedAt: new Date('2026-08-17T04:00:00.000Z'),
        latitude: 18.52,
        longitude: 73.85,
        accuracyMeters: 12,
      };
      const { service, prisma } = build({ existing });
      const ev = await service.submit('emp-1', VALID);
      expect(ev.id).toBe('ev-existing');
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('17. the same key with conflicting evidence is REJECTED', async () => {
      const existing = {
        id: 'ev-existing',
        type: 'PUNCH_IN',
        clientCapturedAt: new Date('2026-08-17T04:00:00.000Z'),
        latitude: 18.52,
        longitude: 73.85,
        accuracyMeters: 12,
      };
      const { service, prisma } = build({ existing });
      await expect(
        service.submit('emp-1', { ...VALID, latitude: 19.9 }),
      ).rejects.toBeInstanceOf(PunchIdempotencyConflictError);
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('a different punch TYPE on the same key is a conflict', async () => {
      const existing = {
        id: 'ev-existing',
        type: 'PUNCH_IN',
        clientCapturedAt: new Date('2026-08-17T04:00:00.000Z'),
        latitude: 18.52,
        longitude: 73.85,
        accuracyMeters: 12,
      };
      const { service } = build({ existing });
      await expect(
        service.submit('emp-1', { ...VALID, type: 'PUNCH_OUT' }),
      ).rejects.toBeInstanceOf(PunchIdempotencyConflictError);
    });

    it('looks up by userId + idempotencyKey, not by timestamp', async () => {
      const { service, prisma } = build();
      await service.submit('emp-1', VALID);
      expect(prisma.attendancePunchEvidence.findUnique).toHaveBeenCalledWith({
        where: { userId_idempotencyKey: { userId: 'emp-1', idempotencyKey: 'idem-1' } },
      });
    });

    it('a missing idempotencyKey is rejected', async () => {
      const { service } = build();
      await expect(
        service.submit('emp-1', { type: 'PUNCH_IN' } as any),
      ).rejects.toBeInstanceOf(PunchValidationError);
    });
  });

  describe('scoping and feature flag', () => {
    it('18. history is scoped to the authenticated employee', async () => {
      const { service, prisma } = build();
      await service.listMine('emp-1');
      expect(prisma.attendancePunchEvidence.findMany.mock.calls[0][0].where).toEqual({
        userId: 'emp-1',
      });
    });

    it('18b. the history query cannot be widened by the caller', async () => {
      const { service, prisma } = build();
      await service.listMine('emp-1', 100000);
      const args = prisma.attendancePunchEvidence.findMany.mock.calls[0][0];
      expect(args.where.userId).toBe('emp-1');
      expect(args.take).toBeLessThanOrEqual(200);
    });

    it('19. with the feature flag OFF, creation is refused and nothing is written', async () => {
      const { service, prisma } = build({ enabled: false });
      await expect(service.submit('emp-1', VALID)).rejects.toBeInstanceOf(
        PunchFeatureDisabledError,
      );
      expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    });

    it('19b. the flag defaults OFF when the setting is absent', async () => {
      const { service, settings } = build();
      settings.get.mockResolvedValue({});
      await expect(service.submit('emp-1', VALID)).rejects.toBeInstanceOf(
        PunchFeatureDisabledError,
      );
    });

    it('19c. the flag is checked before any context resolution or write', async () => {
      const { service, dailyContext, prisma } = build({ enabled: false });
      await expect(service.submit('emp-1', VALID)).rejects.toBeInstanceOf(
        PunchFeatureDisabledError,
      );
      expect(dailyContext.resolveDailyContext).not.toHaveBeenCalled();
      expect(prisma.attendancePunchEvidence.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('append-only', () => {
    it('20/21. the service exposes no update or delete operation', () => {
      const surface = Object.getOwnPropertyNames(PunchEvidenceService.prototype);
      for (const banned of ['update', 'delete', 'remove', 'destroy', 'edit', 'patch']) {
        expect(surface).not.toContain(banned);
      }
    });

    it('20/21b. the controller exposes no update or delete route', () => {
      const surface = Object.getOwnPropertyNames(PunchEvidenceController.prototype);
      expect(surface.sort()).toEqual(['constructor', 'listMine', 'submit']);
    });

    it('never calls a Prisma update or delete on the evidence table', async () => {
      const { service, prisma } = build();
      await service.submit('emp-1', VALID);
      expect((prisma.attendancePunchEvidence as any).update).toBeUndefined();
      expect((prisma.attendancePunchEvidence as any).delete).toBeUndefined();
      expect((prisma.attendancePunchEvidence as any).deleteMany).toBeUndefined();
    });
  });

  describe('layer boundaries', () => {
    it('22. never mutates WorkSession or BreakLog', async () => {
      const { service, prisma } = build();
      await service.submit('emp-1', VALID);
      for (const fn of Object.values(prisma.workSession)) expect(fn).not.toHaveBeenCalled();
      for (const fn of Object.values(prisma.breakLog)) expect(fn).not.toHaveBeenCalled();
    });

    it('23. never touches DailyAttendance', async () => {
      const { service, prisma } = build();
      await service.submit('emp-1', VALID);
      for (const fn of Object.values(prisma.dailyAttendance)) expect(fn).not.toHaveBeenCalled();
    });

    it('does not write to the legacy AttendanceEvent audit stream', async () => {
      const { service, prisma } = build();
      await service.submit('emp-1', VALID);
      expect(prisma.attendanceEvent.create).not.toHaveBeenCalled();
    });

    it('27. performs no attendance classification', async () => {
      const { service, created } = build();
      await service.submit('emp-1', VALID);
      for (const banned of [
        'status',
        'attendanceStatus',
        'present',
        'absent',
        'halfDay',
        'lwp',
        'lateMinutes',
        'workedMinutes',
        'leaveDeducted',
      ]) {
        expect(created[0]).not.toHaveProperty(banned);
      }
    });
  });

  describe('provenance and audit', () => {
    it('24. evidence carries the BL-5 profile and policy provenance', async () => {
      const { service, created } = build();
      await service.submit('emp-1', VALID);
      expect(created[0]).toMatchObject({
        employeeProfileId: 'prof-1',
        shiftPolicyId: 'shift-1',
        shiftPolicyVersion: 2,
        attendancePolicyId: 'ap-1',
        attendancePolicyVersion: 3,
        contextResolverVersion: 1,
      });
    });

    it('25. creating evidence emits an operational audit event', async () => {
      const { service, eventLogger } = build();
      await service.submit('emp-1', VALID);
      expect(eventLogger.log).toHaveBeenCalledTimes(1);
      const e = eventLogger.log.mock.calls[0][0];
      expect(e.action).toBe('ATTENDANCE_PUNCH_RECORDED');
      expect(e.entityType).toBe('AttendancePunchEvidence');
      expect(e.actorId).toBe('emp-1');
      expect(e.entityId).toBe('ev-1');
    });

    it('26. the audit event carries no photo bytes, coordinates or device payload', async () => {
      const { service, eventLogger } = build();
      await service.submit('emp-1', VALID);
      const meta = eventLogger.log.mock.calls[0][0].metadata;
      for (const banned of [
        'latitude',
        'longitude',
        'accuracyMeters',
        'photo',
        'photoBytes',
        'photoObjectKey',
        'photoHash',
        'deviceMetadata',
        'ipAddress',
      ]) {
        expect(meta).not.toHaveProperty(banned);
      }
      const serialised = JSON.stringify(meta);
      expect(serialised).not.toContain('18.52');
      expect(serialised).not.toContain('73.85');
    });

    it('a failing audit write never fails the punch', async () => {
      const { service, eventLogger } = build();
      eventLogger.log.mockRejectedValue(new Error('audit down'));
      await expect(service.submit('emp-1', VALID)).resolves.toBeDefined();
    });
  });

  describe('photo state', () => {
    it('records PENDING and accepts no photo input in PE-1', async () => {
      const { service, created } = build();
      await service.submit('emp-1', {
        ...VALID,
        photoObjectKey: 'https://evil.example/pic.jpg',
        photoVerification: 'CAPTURED',
      } as any);
      expect(created[0].photoVerification).toBe('PENDING');
      expect(created[0].photoObjectKey).toBeUndefined();
    });
  });
});
