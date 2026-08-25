import { PunchEvidenceService } from '../../src/modules/platform/attendance/punch/punch-evidence.service';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import {
  PunchFeatureDisabledError,
  PunchIdempotencyConflictError,
  PunchNoOpenWorkdayError,
  PunchNotApplicableError,
  PunchPhotoRequiredError,
  PunchValidationError,
} from '../../src/modules/platform/attendance/punch/punch-evidence.types';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// PE-4: the punch and the workday mutation must commit as one unit.
//
// The rig below models a transaction honestly rather than trivially: writes
// land in a staging buffer and are promoted to the committed buffer only when
// the callback resolves. If the callback throws, the staged writes are dropped
// exactly as a ROLLBACK drops them. Without that, every "is it atomic?"
// assertion would pass by construction and prove nothing.
//
// The second half of this file drives the REAL WorkdayService, because the
// claim "punch out reuses the existing finalizer" is only worth anything if the
// existing finalizer's own arithmetic is what runs.

const PUNE_OFFICE = { latitude: 18.5204, longitude: 73.8567 };

const FRESH_PHOTO = {
  id: 'photo-1',
  userId: 'emp-1',
  objectKey: 'cloudinary:authenticated:image:x:jpg',
  sha256: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 5 * 60_000),
  punchEvidence: null,
};

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

const OFFICE_LOCATION = {
  id: 'loc-1',
  latitude: PUNE_OFFICE.latitude,
  longitude: PUNE_OFFICE.longitude,
  radiusMeters: 150,
  minimumAccuracyMeters: 75,
};

const PUNCH_IN = {
  type: 'PUNCH_IN' as const,
  idempotencyKey: 'idem-in-1',
  latitude: PUNE_OFFICE.latitude,
  longitude: PUNE_OFFICE.longitude,
  accuracyMeters: 12,
  photoAssetId: 'photo-1',
};

const PUNCH_OUT = { ...PUNCH_IN, type: 'PUNCH_OUT' as const, idempotencyKey: 'idem-out-1' };

const OPEN_SESSION = {
  id: 'ws-1',
  userId: 'emp-1',
  status: 'WORKING',
  logoutAt: null,
  startWorkAt: new Date('2026-08-20T03:30:00.000Z'),
};

/** Moves north by a given number of metres. 1 deg latitude ~ 111.2 km. */
const northOf = (m: number) => ({
  latitude: PUNE_OFFICE.latitude + m / 111_195,
  longitude: PUNE_OFFICE.longitude,
});

interface RigOptions {
  enabled?: boolean;
  context?: any;
  existing?: any;
  photo?: any;
  openSession?: any;
  activeLocations?: any[];
  evidenceCreateError?: Error;
  startError?: Error;
  finalizeError?: Error;
}

function rig(opts: RigOptions = {}) {
  // Committed vs staged: the difference between "the database kept it" and
  // "the code called it before the transaction unwound".
  const committedEvidence: any[] = [];
  const committedWorkdayOps: string[] = [];
  let stagedEvidence: any[] = [];
  let stagedWorkdayOps: string[] = [];

  const workday: any = {
    startWorkInTransaction: jest.fn(async () => {
      stagedWorkdayOps.push('START');
      if (opts.startError) throw opts.startError;
      return { session: { id: 'ws-new', userId: 'emp-1' }, wasAutoClosed: false };
    }),
    afterWorkStarted: jest.fn().mockResolvedValue(undefined),
    finalizeWorkSessionInTransaction: jest.fn(async () => {
      stagedWorkdayOps.push('FINALIZE');
      if (opts.finalizeError) throw opts.finalizeError;
      return {
        session: { id: 'ws-1' },
        totalWorkMinutes: 465,
        totalBreakMinutes: 15,
        didClose: true,
        userId: 'emp-1',
      };
    }),
    afterWorkSessionFinalized: jest.fn().mockResolvedValue(undefined),
    markUserLoggedOut: jest.fn().mockResolvedValue(undefined),
  };

  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => {
      stagedEvidence = [];
      stagedWorkdayOps = [];
      try {
        const out = await fn(prisma);
        committedEvidence.push(...stagedEvidence);
        committedWorkdayOps.push(...stagedWorkdayOps);
        return out;
      } catch (err) {
        // ROLLBACK: nothing staged inside this transaction survives.
        stagedEvidence = [];
        stagedWorkdayOps = [];
        throw err;
      }
    }),
    attendancePunchEvidence: {
      findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: any) => {
        if (opts.evidenceCreateError) return Promise.reject(opts.evidenceCreateError);
        const row = { id: 'ev-1', ...data };
        stagedEvidence.push(row);
        return Promise.resolve(row);
      }),
    },
    attendancePunchPhoto: {
      findUnique: jest.fn(() =>
        Promise.resolve('photo' in opts ? opts.photo : { ...FRESH_PHOTO }),
      ),
    },
    attendanceLocation: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue(opts.activeLocations ?? []),
    },
    workSession: {
      findFirst: jest.fn().mockResolvedValue(
        'openSession' in opts ? opts.openSession : OPEN_SESSION,
      ),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { update: jest.fn() },
  };

  const settings = {
    get: jest.fn().mockResolvedValue({ punchEvidenceEnabled: opts.enabled ?? true }),
  };
  const eventLogger = { log: jest.fn().mockResolvedValue(undefined) };
  const dailyContext = {
    resolveDailyContext: jest.fn().mockResolvedValue(opts.context ?? REQUIRED_CONTEXT),
  };
  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);

  const service = new PunchEvidenceService(
    prisma,
    tva,
    settings as any,
    eventLogger as any,
    dailyContext as any,
    workday,
  );

  return { service, prisma, workday, committedEvidence, committedWorkdayOps, eventLogger };
}

describe('PE-4 punch starts a workday', () => {
  it('1. a valid PUNCH_IN starts the workday through the workday engine', async () => {
    const { service, workday } = rig();
    await service.submit('emp-1', PUNCH_IN);
    expect(workday.startWorkInTransaction).toHaveBeenCalledTimes(1);
  });

  it('2. the evidence links the WorkSession the start created', async () => {
    const { service, committedEvidence } = rig();
    await service.submit('emp-1', PUNCH_IN);
    expect(committedEvidence[0].workSessionId).toBe('ws-new');
  });

  it('3. the start and the evidence share one transaction', async () => {
    const { service, prisma, workday, committedEvidence, committedWorkdayOps } = rig();
    await service.submit('emp-1', PUNCH_IN);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(committedWorkdayOps).toEqual(['START']);
    expect(committedEvidence).toHaveLength(1);
    // The start ran before the insert, so the linked session id is a real one
    // and never a placeholder to be patched in afterwards.
    expect(workday.startWorkInTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.attendancePunchEvidence.create.mock.invocationCallOrder[0],
    );
  });

  it('4. an evidence insert failure rolls the workday start back', async () => {
    const { service, workday, committedEvidence, committedWorkdayOps } = rig({
      evidenceCreateError: new Error('insert exploded'),
    });

    await expect(service.submit('emp-1', PUNCH_IN)).rejects.toThrow('insert exploded');

    expect(workday.startWorkInTransaction).toHaveBeenCalledTimes(1); // attempted
    expect(committedWorkdayOps).toEqual([]); // ...and did not survive
    expect(committedEvidence).toEqual([]);
  });

  it('5. a workday start failure produces no evidence at all', async () => {
    const { service, prisma, committedEvidence, committedWorkdayOps } = rig({
      startError: new Error('No active session'),
    });

    await expect(service.submit('emp-1', PUNCH_IN)).rejects.toThrow('No active session');

    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    expect(committedEvidence).toEqual([]);
    expect(committedWorkdayOps).toEqual([]);
  });

  it('6. an invalid GPS reading never reaches the workday', async () => {
    const { service, prisma, workday } = rig();

    await expect(
      service.submit('emp-1', { ...PUNCH_IN, latitude: 99 as any }),
    ).rejects.toBeInstanceOf(PunchValidationError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(workday.startWorkInTransaction).not.toHaveBeenCalled();
  });

  it('7. a blocked daily context never reaches the workday', async () => {
    const { service, prisma, workday } = rig({
      context: {
        ...REQUIRED_CONTEXT,
        attendanceApplicability: 'BLOCKED',
        blockingReasons: ['MISSING_SHIFT_ASSIGNMENT'],
      },
    });

    await expect(service.submit('emp-1', PUNCH_IN)).rejects.toBeInstanceOf(
      PunchNotApplicableError,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(workday.startWorkInTransaction).not.toHaveBeenCalled();
  });

  it('8. a missing or expired photo never reaches the workday', async () => {
    const missing = rig({ photo: null });
    await expect(missing.service.submit('emp-1', PUNCH_IN)).rejects.toBeInstanceOf(
      PunchPhotoRequiredError,
    );
    expect(missing.workday.startWorkInTransaction).not.toHaveBeenCalled();

    const expired = rig({
      photo: { ...FRESH_PHOTO, expiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(expired.service.submit('emp-1', PUNCH_IN)).rejects.toMatchObject({
      rejection: 'PHOTO_EXPIRED',
    });
    expect(expired.workday.startWorkInTransaction).not.toHaveBeenCalled();
    expect(expired.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('9. an exact PUNCH_IN retry returns the original and does not start again', async () => {
    const original = {
      id: 'ev-1',
      userId: 'emp-1',
      type: 'PUNCH_IN',
      workSessionId: 'ws-new',
      idempotencyKey: 'idem-in-1',
      latitude: PUNCH_IN.latitude,
      longitude: PUNCH_IN.longitude,
      accuracyMeters: 12,
      photoAssetId: 'photo-1',
    };
    const { service, workday, prisma } = rig({ existing: original });

    const result = await service.submit('emp-1', PUNCH_IN);

    expect(result.id).toBe('ev-1');
    expect(workday.startWorkInTransaction).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
  });

  it('10. a conflicting retry of the same key touches nothing', async () => {
    const original = {
      id: 'ev-1',
      userId: 'emp-1',
      type: 'PUNCH_OUT', // same key, different intent
      workSessionId: 'ws-9',
      idempotencyKey: 'idem-in-1',
    };
    const { service, workday, prisma } = rig({ existing: original });

    await expect(service.submit('emp-1', PUNCH_IN)).rejects.toBeInstanceOf(
      PunchIdempotencyConflictError,
    );
    expect(workday.startWorkInTransaction).not.toHaveBeenCalled();
    expect(workday.finalizeWorkSessionInTransaction).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
  });
});

describe('PE-4 punch closes a workday', () => {
  it('11. a valid PUNCH_OUT closes through the existing finalizer', async () => {
    const { service, workday } = rig();
    await service.submit('emp-1', PUNCH_OUT);

    expect(workday.finalizeWorkSessionInTransaction).toHaveBeenCalledTimes(1);
    const [, sessionId, options] = workday.finalizeWorkSessionInTransaction.mock.calls[0];
    expect(sessionId).toBe('ws-1');
    expect(options).toMatchObject({
      terminalStatus: 'LOGGED_OUT',
      closureReason: 'ENDED_BY_PUNCH_OUT',
      attendanceEventType: 'LOGOUT',
      ticketPauseReason: 'LOGOUT',
    });

    // Side effects run AFTER the commit, and the presence flip goes through the
    // workday engine's authority rather than a second writer of user status.
    expect(workday.afterWorkSessionFinalized).toHaveBeenCalledTimes(1);
    expect(workday.markUserLoggedOut).toHaveBeenCalledWith('emp-1');
    expect(
      workday.afterWorkSessionFinalized.mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      workday.finalizeWorkSessionInTransaction.mock.invocationCallOrder[0],
    );
  });

  it('12. the evidence links the finalized WorkSession', async () => {
    const { service, committedEvidence } = rig();
    await service.submit('emp-1', PUNCH_OUT);
    expect(committedEvidence[0].workSessionId).toBe('ws-1');
  });

  it('13. the finalize and the evidence share one transaction', async () => {
    const { service, prisma, committedEvidence, committedWorkdayOps } = rig();
    await service.submit('emp-1', PUNCH_OUT);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(committedWorkdayOps).toEqual(['FINALIZE']);
    expect(committedEvidence).toHaveLength(1);
  });

  it('14. an evidence insert failure rolls the finalization back', async () => {
    const { service, workday, committedEvidence, committedWorkdayOps } = rig({
      evidenceCreateError: new Error('insert exploded'),
    });

    await expect(service.submit('emp-1', PUNCH_OUT)).rejects.toThrow('insert exploded');

    expect(workday.finalizeWorkSessionInTransaction).toHaveBeenCalledTimes(1);
    expect(committedWorkdayOps).toEqual([]);
    expect(committedEvidence).toEqual([]);
  });

  it('15. a finalizer failure produces no evidence', async () => {
    const { service, prisma, committedEvidence, committedWorkdayOps } = rig({
      finalizeError: new Error('finalizer exploded'),
    });

    await expect(service.submit('emp-1', PUNCH_OUT)).rejects.toThrow('finalizer exploded');

    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
    expect(committedEvidence).toEqual([]);
    expect(committedWorkdayOps).toEqual([]);
  });

  it('16. a PUNCH_OUT with no open session is rejected and writes nothing', async () => {
    const none = rig({ openSession: null });
    await expect(none.service.submit('emp-1', PUNCH_OUT)).rejects.toBeInstanceOf(
      PunchNoOpenWorkdayError,
    );
    expect(none.committedEvidence).toEqual([]);
    expect(none.workday.finalizeWorkSessionInTransaction).not.toHaveBeenCalled();

    // An already-closed session is equally not open. Punching out of it would
    // otherwise re-close it and move a recorded logout time.
    const closed = rig({
      openSession: { ...OPEN_SESSION, status: 'LOGGED_OUT', logoutAt: new Date() },
    });
    await expect(closed.service.submit('emp-1', PUNCH_OUT)).rejects.toBeInstanceOf(
      PunchNoOpenWorkdayError,
    );
    expect(closed.workday.finalizeWorkSessionInTransaction).not.toHaveBeenCalled();
    expect(closed.committedEvidence).toEqual([]);
  });

  it('17. an exact PUNCH_OUT retry does not finalize twice', async () => {
    const original = {
      id: 'ev-2',
      userId: 'emp-1',
      type: 'PUNCH_OUT',
      workSessionId: 'ws-1',
      idempotencyKey: 'idem-out-1',
      latitude: PUNCH_OUT.latitude,
      longitude: PUNCH_OUT.longitude,
      accuracyMeters: 12,
      photoAssetId: 'photo-1',
    };
    const { service, workday } = rig({ existing: original });

    const result = await service.submit('emp-1', PUNCH_OUT);

    expect(result.id).toBe('ev-2');
    expect(workday.finalizeWorkSessionInTransaction).not.toHaveBeenCalled();
  });

  it('18. a conflicting PUNCH_OUT retry does not finalize', async () => {
    const original = {
      id: 'ev-2',
      userId: 'emp-1',
      type: 'PUNCH_IN',
      workSessionId: 'ws-1',
      idempotencyKey: 'idem-out-1',
    };
    const { service, workday } = rig({ existing: original });

    await expect(service.submit('emp-1', PUNCH_OUT)).rejects.toBeInstanceOf(
      PunchIdempotencyConflictError,
    );
    expect(workday.finalizeWorkSessionInTransaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The real workday engine, driven through the punch.
//
// Tests 19-22 and 29-30 assert properties of the EXISTING finalizer, so they
// use the actual WorkdayService rather than a mock of it. That is the only way
// to show the punch inherits the existing break, total and start-time rules
// instead of quietly reimplementing them.
// ─────────────────────────────────────────────────────────────────────────────

const START_AT = new Date('2026-08-20T03:30:00.000Z'); // 09:00 IST
const END_AT = new Date('2026-08-20T11:30:00.000Z'); // 17:00 IST -> 480 min elapsed

function realWorkdayRig(
  opts: { breakLogs?: any[]; session?: any; activeTicketLogs?: number } = {},
) {
  const session = {
    id: 'ws-1',
    userId: 'emp-1',
    status: 'WORKING',
    logoutAt: null,
    startWorkAt: START_AT,
    totalWorkMinutes: 0,
    totalBreakMinutes: 0,
    autoClosed: false,
    closureReason: null,
    breakLogs: opts.breakLogs ?? [],
    ...(opts.session ?? {}),
  };

  const breakUpdates: any[] = [];
  const sessionUpdates: any[] = [];
  const attendanceEvents: any[] = [];
  const statusChanges: any[] = [];
  const createdSessions: any[] = [];
  const pausedLedgers: any[] = [];

  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'ws-1' }]),
    workSession: {
      findUnique: jest.fn().mockResolvedValue(session),
      findFirst: jest.fn().mockResolvedValue(session),
    },
    ticketTimeLog: { count: jest.fn().mockResolvedValue(opts.activeTicketLogs ?? 0) },
    breakLog: {
      update: jest.fn((args: any) => {
        breakUpdates.push(args);
        return Promise.resolve(args);
      }),
    },
    attendanceEvent: {
      create: jest.fn((args: any) => {
        attendanceEvents.push(args.data);
        return Promise.resolve(args.data);
      }),
    },
  };

  const prisma: any = {
    ...tx,
    $transaction: jest.fn((fn: any) => fn(tx)),
  };

  const attendanceAuthority: any = {
    updateWorkSession: jest.fn((id: string, data: any) => {
      sessionUpdates.push(data);
      return Promise.resolve({ ...session, ...data });
    }),
    createWorkSession: jest.fn((data: any) => {
      createdSessions.push(data);
      return Promise.resolve({ id: 'ws-created', ...data });
    }),
    setUserStatus: jest.fn((userId: string, status: string) => {
      statusChanges.push(status);
      return Promise.resolve(undefined);
    }),
  };

  const ticketLedger: any = {
    pauseActiveLogsForUser: jest.fn((args: any) => {
      pausedLedgers.push(args);
      return Promise.resolve(undefined);
    }),
  };

  const eventLogger: any = { log: jest.fn().mockResolvedValue(undefined) };
  const notificationEventService: any = {
    sendNotification: jest.fn().mockResolvedValue(undefined),
  };
  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);

  const workday = new WorkdayService(
    prisma,
    {} as any,
    eventLogger,
    ticketLedger,
    notificationEventService,
    attendanceAuthority,
    tva,
  );

  return {
    workday,
    prisma,
    tx,
    session,
    breakUpdates,
    sessionUpdates,
    attendanceEvents,
    statusChanges,
    createdSessions,
    pausedLedgers,
    eventLogger,
    attendanceAuthority,
  };
}

/** Punch service wired to a REAL WorkdayService. */
function punchWithRealWorkday(opts: Parameters<typeof realWorkdayRig>[0] = {}) {
  const wd = realWorkdayRig(opts);
  const created: any[] = [];

  const prisma: any = {
    $transaction: jest.fn((fn: any) => fn(prisma)),
    ...wd.tx,
    attendancePunchEvidence: {
      findUnique: jest.fn().mockResolvedValue(null),
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
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { update: jest.fn() },
  };

  const settings = { get: jest.fn().mockResolvedValue({ punchEvidenceEnabled: true }) };
  const eventLogger = { log: jest.fn().mockResolvedValue(undefined) };
  const dailyContext = {
    resolveDailyContext: jest.fn().mockResolvedValue(REQUIRED_CONTEXT),
  };
  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);

  const service = new PunchEvidenceService(
    prisma,
    tva,
    settings as any,
    eventLogger as any,
    dailyContext as any,
    wd.workday,
  );

  return { ...wd, service, created, punchPrisma: prisma };
}

describe('PE-4 the punch inherits the existing finalizer behaviour', () => {
  it('19. an open break is closed through the existing finalizer', async () => {
    const { service, breakUpdates } = punchWithRealWorkday({
      breakLogs: [
        { id: 'b-1', breakType: 'LUNCH', startAt: new Date('2026-08-20T07:30:00.000Z'), endAt: null },
      ],
    });

    await service.submit('emp-1', PUNCH_OUT);

    expect(breakUpdates).toHaveLength(1);
    expect(breakUpdates[0].where).toEqual({ id: 'b-1' });
    expect(breakUpdates[0].data.endAt).toBeInstanceOf(Date);
    expect(breakUpdates[0].data.durationMinutes).toBeGreaterThan(0);
  });

  it('20. the frozen totalWorkMinutes is elapsed time minus non-meeting breaks', async () => {
    const { service, sessionUpdates } = punchWithRealWorkday({
      breakLogs: [
        {
          id: 'b-1',
          breakType: 'LUNCH',
          startAt: new Date('2026-08-20T07:00:00.000Z'),
          endAt: new Date('2026-08-20T07:30:00.000Z'),
          durationMinutes: 30,
        },
      ],
    });

    await service.submit('emp-1', PUNCH_OUT);

    const update = sessionUpdates[0];
    expect(update.totalBreakMinutes).toBe(30);
    // Elapsed is measured to the punch instant, so assert the invariant rather
    // than a wall-clock constant: work = elapsed - break, and never negative.
    const elapsed = Math.floor((update.logoutAt.getTime() - START_AT.getTime()) / 60000);
    expect(update.totalWorkMinutes).toBe(Math.max(0, elapsed - 30));
    expect(update.totalWorkMinutes).toBeGreaterThanOrEqual(0);
  });

  it('21. the original startWorkAt is never rewritten by a punch out', async () => {
    const { service, sessionUpdates, session } = punchWithRealWorkday();

    await service.submit('emp-1', PUNCH_OUT);

    expect(Object.keys(sessionUpdates[0])).not.toContain('startWorkAt');
    expect(session.startWorkAt).toBe(START_AT);
  });

  it('22. MEETING time keeps counting as work, not break', async () => {
    const meeting = punchWithRealWorkday({
      breakLogs: [
        {
          id: 'b-1',
          breakType: 'MEETING',
          startAt: new Date('2026-08-20T07:00:00.000Z'),
          endAt: new Date('2026-08-20T08:00:00.000Z'),
          durationMinutes: 60,
        },
      ],
    });
    await meeting.service.submit('emp-1', PUNCH_OUT);

    // A 60 minute meeting contributes nothing to break time...
    expect(meeting.sessionUpdates[0].totalBreakMinutes).toBe(0);

    const lunch = punchWithRealWorkday({
      breakLogs: [
        {
          id: 'b-1',
          breakType: 'LUNCH',
          startAt: new Date('2026-08-20T07:00:00.000Z'),
          endAt: new Date('2026-08-20T08:00:00.000Z'),
          durationMinutes: 60,
        },
      ],
    });
    await lunch.service.submit('emp-1', PUNCH_OUT);

    // ...whereas the same hour as lunch does.
    expect(lunch.sessionUpdates[0].totalBreakMinutes).toBe(60);
    expect(meeting.sessionUpdates[0].totalWorkMinutes).toBe(
      lunch.sessionUpdates[0].totalWorkMinutes + 60,
    );
  });
});

describe('PE-4 geofence and photo verdicts still link a workday', () => {
  it('23. with geoFenceEnabled the verdict is still computed and enforced', async () => {
    const inside = rig({
      context: { ...REQUIRED_CONTEXT, attendancePolicy: { geoFenceEnabled: true } },
      activeLocations: [OFFICE_LOCATION],
    });
    await inside.service.submit('emp-1', PUNCH_IN);
    expect(inside.committedEvidence[0].locationVerification).toBe('VERIFIED');

    const outside = rig({
      context: { ...REQUIRED_CONTEXT, attendancePolicy: { geoFenceEnabled: true } },
      activeLocations: [OFFICE_LOCATION],
    });
    await outside.service.submit('emp-1', { ...PUNCH_IN, ...northOf(900) });
    expect(outside.committedEvidence[0].locationVerification).toBe('OUTSIDE_GEOFENCE');
  });

  it('24. with geoFenceEnabled off the reading is stored as NOT_ENFORCED', async () => {
    const { service, committedEvidence } = rig();
    await service.submit('emp-1', { ...PUNCH_IN, ...northOf(50_000) });

    const row = committedEvidence[0];
    expect(row.locationVerification).toBe('NOT_ENFORCED');
    // GPS capture is unaffected by enforcement: the reading is still recorded.
    expect(row.latitude).toBeCloseTo(northOf(50_000).latitude, 6);
    expect(row.workSessionId).toBe('ws-new');
  });

  it('25. OUTSIDE_GEOFENCE still links the workday rather than blocking it', async () => {
    const { service, workday, committedEvidence } = rig({
      context: { ...REQUIRED_CONTEXT, attendancePolicy: { geoFenceEnabled: true } },
      activeLocations: [OFFICE_LOCATION],
    });

    await service.submit('emp-1', { ...PUNCH_IN, ...northOf(900) });

    // Being in the wrong place is an HR review matter, not a reason to deny
    // someone their workday.
    expect(workday.startWorkInTransaction).toHaveBeenCalledTimes(1);
    expect(committedEvidence[0].workSessionId).toBe('ws-new');
    expect(committedEvidence[0].locationVerification).toBe('OUTSIDE_GEOFENCE');
  });

  it('26. LOW_ACCURACY still links the workday rather than blocking it', async () => {
    const { service, workday, committedEvidence } = rig({
      context: { ...REQUIRED_CONTEXT, attendancePolicy: { geoFenceEnabled: true } },
      activeLocations: [OFFICE_LOCATION],
    });

    await service.submit('emp-1', { ...PUNCH_IN, accuracyMeters: 5_000 });

    expect(workday.startWorkInTransaction).toHaveBeenCalledTimes(1);
    expect(committedEvidence[0].workSessionId).toBe('ws-new');
    expect(committedEvidence[0].locationVerification).toBe('LOW_ACCURACY');
  });

  it('27. the linked punch always carries a CAPTURED photo', async () => {
    const { service, committedEvidence } = rig();
    await service.submit('emp-1', PUNCH_IN);

    const row = committedEvidence[0];
    expect(row.photoVerification).toBe('CAPTURED');
    expect(row.photoAssetId).toBe('photo-1');
    expect(row.workSessionId).toBe('ws-new');
  });

  it('28. losing the one-use photo race rolls the workday mutation back', async () => {
    // The pre-check cannot close this race; the unique index on photoAssetId
    // does, by failing the insert inside the transaction.
    const uniqueViolation: any = new Error(
      'Unique constraint failed on the fields: (`photoAssetId`)',
    );
    uniqueViolation.code = 'P2002';
    uniqueViolation.meta = { target: ['photoAssetId'] };

    const { service, workday, committedEvidence, committedWorkdayOps } = rig({
      evidenceCreateError: uniqueViolation,
    });

    await expect(service.submit('emp-1', PUNCH_IN)).rejects.toMatchObject({ code: 'P2002' });

    expect(workday.startWorkInTransaction).toHaveBeenCalledTimes(1);
    expect(committedWorkdayOps).toEqual([]); // the start did not survive
    expect(committedEvidence).toEqual([]);
  });
});

describe('PE-4 the legacy workday paths are untouched', () => {
  it('29. the existing Workday start endpoint still behaves identically', async () => {
    const rigged = realWorkdayRig({ session: { status: 'LOGGED_IN' } });
    rigged.tx.workSession.findFirst.mockResolvedValue(null); // first start of the day

    const result = await rigged.workday.startWork('emp-1');

    expect(result.message).toBe('Workday started');
    expect(rigged.createdSessions).toHaveLength(1);
    expect(rigged.createdSessions[0]).toMatchObject({ userId: 'emp-1', status: 'WORKING' });
    expect(rigged.attendanceEvents[0]).toMatchObject({
      eventType: 'START_WORK',
      source: 'manual',
    });
    expect(rigged.statusChanges).toContain('WORKING');
    // Post-commit audit still fires exactly once.
    expect(rigged.eventLogger.log).toHaveBeenCalledTimes(1);
  });

  it('30. the existing End Day path still goes through the shared finalizer', async () => {
    const rigged = realWorkdayRig({
      breakLogs: [
        { id: 'b-1', breakType: 'LUNCH', startAt: new Date('2026-08-20T07:00:00.000Z'), endAt: null },
      ],
    });

    const result = await rigged.workday.endWork('emp-1');

    // Same closure work as before: break closed, totals frozen, ledger paused.
    expect(rigged.breakUpdates).toHaveLength(1);
    expect(rigged.sessionUpdates[0]).toMatchObject({
      status: 'LOGGED_OUT',
      closureReason: 'ENDED_BY_USER',
    });
    expect(rigged.pausedLedgers[0]).toMatchObject({ userId: 'emp-1', pauseReason: 'LOGOUT' });
    expect(rigged.statusChanges).toContain('LOGGED_OUT');
    expect(result.summary.totalWorkMinutes).toBeGreaterThanOrEqual(0);
  });

  it('31. with the feature off the punch does nothing to the workday', async () => {
    const { service, prisma, workday } = rig({ enabled: false });

    await expect(service.submit('emp-1', PUNCH_IN)).rejects.toBeInstanceOf(
      PunchFeatureDisabledError,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(workday.startWorkInTransaction).not.toHaveBeenCalled();
    expect(workday.finalizeWorkSessionInTransaction).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();

    // And the legacy path is entirely unaffected by the flag: it never consults
    // it, so End Day keeps working exactly as it does today.
    const legacy = realWorkdayRig();
    const result = await legacy.workday.endWork('emp-1');
    expect(legacy.sessionUpdates[0]).toMatchObject({ closureReason: 'ENDED_BY_USER' });
    expect(result.summary).toBeDefined();
  });
});
