/**
 * Unit tests — Workday Release A.3
 *
 * Guards the login/workday decoupling from the workday side:
 *  - Start Work is the ONLY path that explicitly creates/starts a session.
 *  - getToday is read-only: it returns today's latest session (or null) and
 *    never creates a WorkSession row.
 *
 * Prisma + collaborators are fully mocked to isolate WorkdayService.
 */
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';

const mockPrisma: any = {
  workSession:   { upsert: jest.fn(), findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  attendanceEvent: { create: jest.fn() },
  user:          { update: jest.fn(), findUnique: jest.fn() },
  leaveRequest:  { findFirst: jest.fn() },
};
const mockEventLogger: any = { log: jest.fn().mockResolvedValue(undefined) };

describe('WorkdayService — Release A.3 (explicit start, read-only getToday)', () => {
  let service: WorkdayService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkdayService(mockPrisma, {} as any, mockEventLogger);
  });

  it('Test 5 — Start Work explicitly creates/starts a WORKING session', async () => {
    mockPrisma.workSession.upsert.mockResolvedValue({ id: 'ws1', status: 'WORKING' });
    mockPrisma.attendanceEvent.create.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});

    await service.startWork('u1');

    expect(mockPrisma.workSession.upsert).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.workSession.upsert.mock.calls[0][0];
    // Explicitly STARTS work on both the create and update paths: WORKING + a
    // fresh startWorkAt. This is the only place that does so.
    expect(arg.create.status).toBe('WORKING');
    expect(arg.create.startWorkAt).toBeInstanceOf(Date);
    expect(arg.update.status).toBe('WORKING');
    expect(arg.update.startWorkAt).toBeInstanceOf(Date);
    // Denormalized user status follows the explicit action.
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentStatus: 'WORKING' }) }),
    );
  });

  it('getToday returns the latest same-day session via findFirst, read-only (no row created)', async () => {
    const session = {
      id: 'ws1', status: 'LOGGED_OUT', startWorkAt: new Date(), logoutAt: new Date(),
      totalBreakMinutes: 0, breakLogs: [],
    };
    mockPrisma.workSession.findFirst.mockResolvedValue(session);
    mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);

    const result = await service.getToday('u1');

    // Most-recent same-day session, ordered createdAt desc — never findUnique on
    // a userId_date key.
    expect(mockPrisma.workSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', date: expect.any(Date) },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(result.session).toBe(session);
    // Read-only: getToday must never create/upsert a WorkSession.
    expect(mockPrisma.workSession.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.workSession.create).not.toHaveBeenCalled();
  });

  it('getToday returns a null session when the user has no workday yet (no row created)', async () => {
    mockPrisma.workSession.findFirst.mockResolvedValue(null);
    mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);

    const result = await service.getToday('u1');

    expect(result.session).toBeNull();
    expect(mockPrisma.workSession.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.workSession.create).not.toHaveBeenCalled();
  });
});

describe('WorkdayService — getHistory (login-only filtering + same-day aggregation)', () => {
  let service: WorkdayService;
  const mockAccessPolicy: any = { canViewUser: jest.fn().mockResolvedValue(true) };

  const D = (iso: string) => new Date(iso);
  const day = D('2026-06-10T00:00:00.000Z');

  // Base row factory — override per test. Defaults are a closed, empty session.
  function row(over: any) {
    return {
      id: 'ws-x', userId: 'u1', date: day, status: 'LOGGED_OUT',
      loginAt: null, startWorkAt: null, logoutAt: null,
      totalWorkMinutes: 0, totalBreakMinutes: 0, breakLogs: [],
      createdAt: D('2026-06-10T03:00:00.000Z'), ...over,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccessPolicy.canViewUser.mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', role: {}, department: null });
    service = new WorkdayService(mockPrisma, mockAccessPolicy, mockEventLogger);
  });

  it('excludes login-only rows (LOGGED_IN, no startWorkAt, zero minutes) and uses stable ordering', async () => {
    mockPrisma.workSession.findMany.mockResolvedValue([
      row({ id: 'login-only', status: 'LOGGED_IN', loginAt: D('2026-06-10T09:00:00Z') }),
    ]);

    const result = await service.getHistory('u1', { id: 'admin' });

    // The artifact never reaches the response (defense-in-depth filter)…
    expect(result).toEqual([]);
    // …and the query itself excludes it and orders date desc, createdAt desc.
    const arg = mockPrisma.workSession.findMany.mock.calls[0][0];
    expect(arg.where.NOT).toEqual({ status: 'LOGGED_IN', startWorkAt: null, totalWorkMinutes: 0 });
    expect(arg.orderBy).toEqual([{ date: 'desc' }, { createdAt: 'desc' }]);
  });

  it('shows only the ended session when the day also has an older login-only row', async () => {
    mockPrisma.workSession.findMany.mockResolvedValue([
      row({
        id: 'ended', status: 'LOGGED_OUT', startWorkAt: D('2026-06-10T04:00:00Z'),
        logoutAt: D('2026-06-10T12:00:00Z'), totalWorkMinutes: 300,
        createdAt: D('2026-06-10T04:00:00Z'),
      }),
      row({
        id: 'login-only', status: 'LOGGED_IN', loginAt: D('2026-06-10T03:30:00Z'),
        createdAt: D('2026-06-10T03:30:00Z'),
      }),
    ]);

    const result = await service.getHistory('u1', { id: 'admin' });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ended');
    expect(result[0].status).toBe('LOGGED_OUT');
    expect(result[0].sessionCount).toBe(1);
    expect(result[0].totalWorkMinutes).toBe(300);
    // Timing comes from startWorkAt — the login-only row's loginAt is ignored.
    expect(result[0].startWorkAt).toEqual(D('2026-06-10T04:00:00Z'));
  });

  it('aggregates two valid same-day sessions: count, summed minutes, earliest start, latest status', async () => {
    // Order mirrors the query: latest session of the day first.
    mockPrisma.workSession.findMany.mockResolvedValue([
      row({
        id: 's2', status: 'LOGGED_OUT', startWorkAt: D('2026-06-10T09:00:00Z'),
        logoutAt: D('2026-06-10T13:00:00Z'), totalWorkMinutes: 120, totalBreakMinutes: 10,
        createdAt: D('2026-06-10T09:00:00Z'),
      }),
      row({
        id: 's1', status: 'LOGGED_OUT', startWorkAt: D('2026-06-10T03:00:00Z'),
        logoutAt: D('2026-06-10T07:00:00Z'), totalWorkMinutes: 180, totalBreakMinutes: 20,
        createdAt: D('2026-06-10T03:00:00Z'),
      }),
    ]);

    const result = await service.getHistory('u1', { id: 'admin' });

    expect(result).toHaveLength(1);
    expect(result[0].sessionCount).toBe(2);
    expect(result[0].totalWorkMinutes).toBe(300);
    expect(result[0].totalBreakMinutes).toBe(30);
    expect(result[0].startWorkAt).toEqual(D('2026-06-10T03:00:00Z')); // firstStartTime
    expect(result[0].status).toBe('LOGGED_OUT');                      // latest valid session
    expect(result[0].id).toBe('s2');
  });

  it('lets an active latest valid session control the day status (earlier ended session still summed)', async () => {
    mockPrisma.workSession.findMany.mockResolvedValue([
      row({
        id: 'active', status: 'WORKING', startWorkAt: D('2026-06-10T10:00:00Z'),
        totalWorkMinutes: 0, createdAt: D('2026-06-10T10:00:00Z'),
      }),
      row({
        id: 'ended', status: 'LOGGED_OUT', startWorkAt: D('2026-06-10T03:00:00Z'),
        logoutAt: D('2026-06-10T08:00:00Z'), totalWorkMinutes: 240,
        createdAt: D('2026-06-10T03:00:00Z'),
      }),
    ]);

    const result = await service.getHistory('u1', { id: 'admin' });

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('WORKING');
    expect(result[0].logoutAt).toBeNull();
    expect(result[0].totalWorkMinutes).toBe(240);
    expect(result[0].sessionCount).toBe(2);
  });
});
