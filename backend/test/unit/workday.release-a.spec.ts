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
  workSession:   { upsert: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  attendanceEvent: { create: jest.fn() },
  user:          { update: jest.fn() },
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
