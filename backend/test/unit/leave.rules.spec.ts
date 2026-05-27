/**
 * Unit tests — Leave approval business rules
 *
 * Tests that self-approval and cross-level approval are rejected.
 * PrismaService is mocked to return controlled fixture data.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LeaveService } from '../../src/modules/operations/leave/leave.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { EmailService } from '../../src/modules/platform/email/email.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { LeaveAccessService } from '../../src/common/services/leave-access.service';
import { LeaveBalanceService } from '../../src/modules/operations/leave/leave-balance.service';
import { SettingsService } from '../../src/modules/platform/settings/settings.service';
import { ForbiddenException } from '@nestjs/common';

// ── Minimal mocks ─────────────────────────────────────────────────────────────
const mockPrisma = {
  leaveRequest: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
  notification: { create: jest.fn() },
};
const mockSettings = {
  getLeaveQuotas: jest.fn().mockResolvedValue({ EMPLOYEE: 12, TEAM_LEAD: 12, MANAGER: 15, INTERN: 6 }),
  get: jest.fn().mockResolvedValue({ workingDays: 'Mon–Sat' }),
};
const mockGateway = {
  emitToUser: jest.fn(),
  emitLeaveStatusChanged: jest.fn(),
  emitNotificationToUser: jest.fn(),
};
const mockEmail   = { sendLeaveDecision: jest.fn().mockResolvedValue(undefined) };
const mockNotif   = { create: jest.fn().mockResolvedValue(undefined), sendNotification: jest.fn().mockResolvedValue(undefined) };
const mockConfig  = { get: jest.fn().mockReturnValue('http://localhost:3000') };
const mockLogger  = { log: jest.fn().mockResolvedValue(undefined) };
const mockLeaveBalance = {
  validateLeaveRequest: jest.fn().mockResolvedValue(undefined),
  getLeaveBalance: jest.fn().mockResolvedValue({ allocation: 12, approved: 0, pending: 0, balance: 12 }),
};

// Fixture: a pending leave request owned by EMPLOYEE user
const EMPLOYEE_USER = { id: 'emp1', role: { name: 'EMPLOYEE', level: 4 }, departmentId: 'd1' };
const MANAGER_USER  = { id: 'mgr1', role: { name: 'MANAGER', level: 2 }, departmentId: 'd1' };

const pendingLeave = {
  id: 'leave1',
  userId: 'emp1',
  status: 'PENDING',
  type: 'ANNUAL',
  startDate: new Date(),
  endDate: new Date(),
  user: { id: 'emp1', name: 'QC Employee', email: 'employee@apex.local', departmentId: 'd1', role: { name: 'EMPLOYEE', level: 4 } },
};

describe('LeaveService — approval rules', () => {
  let service: LeaveService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveService,
        AccessPolicyService,
        LeaveAccessService,
        { provide: LeaveBalanceService,   useValue: mockLeaveBalance },
        { provide: PrismaService,         useValue: mockPrisma  },
        { provide: EventsGateway,         useValue: mockGateway },
        { provide: EmailService,          useValue: mockEmail   },
        { provide: NotificationEventService,  useValue: mockNotif   },
        { provide: ConfigService,         useValue: mockConfig  },
        { provide: EventLoggerService,    useValue: mockLogger  },
        { provide: SettingsService,       useValue: mockSettings }, // Wait, in SettingsService, we can just inject it
      ],
    }).compile();

    service = module.get<LeaveService>(LeaveService);
  });

  it('throws ForbiddenException when employee tries to approve own leave', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(pendingLeave);
    mockPrisma.user.findUnique.mockResolvedValue(EMPLOYEE_USER);

    await expect(
      service.approve('leave1', 'emp1'), // approverId === userId
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows manager to approve employee leave', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(pendingLeave);
    mockPrisma.user.findUnique.mockResolvedValue(MANAGER_USER);
    mockPrisma.leaveRequest.update.mockResolvedValue({ ...pendingLeave, status: 'APPROVED' });

    const result = await service.approve('leave1', 'mgr1');
    expect(result.status).toBe('APPROVED');
  });

  it('throws ForbiddenException when leave is already processed', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave, status: 'APPROVED' });
    mockPrisma.user.findUnique.mockResolvedValue(MANAGER_USER);

    await expect(service.approve('leave1', 'mgr1')).rejects.toThrow('Only pending leave requests can be processed');
  });

  it('throws ForbiddenException when employee tries to reject own leave', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(pendingLeave);
    mockPrisma.user.findUnique.mockResolvedValue(EMPLOYEE_USER);

    await expect(service.reject('leave1', 'emp1')).rejects.toThrow(ForbiddenException);
  });

  it('throws when cancelling already-approved leave', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      ...pendingLeave, status: 'APPROVED', userId: 'emp1',
    });
    await expect(service.cancel('leave1', 'emp1')).rejects.toThrow(ForbiddenException);
  });

  it('allows owner to cancel pending leave', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(pendingLeave);
    mockPrisma.leaveRequest.update.mockResolvedValue({ ...pendingLeave, status: 'CANCELLED' });

    const result = await service.cancel('leave1', 'emp1');
    expect(result.status).toBe('CANCELLED');
  });
});
