import { Test, TestingModule } from '@nestjs/testing';
import { ChangeRequestsService } from '../../src/modules/core/users/change-requests.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';

describe('ChangeRequestsService', () => {
  let service: ChangeRequestsService;
  let prisma: any;
  let accessPolicy: any;
  let eventLogger: any;
  let notificationService: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      employeeProfileChangeRequest: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    accessPolicy = {
      roleName: jest.fn(),
      managedDepartmentIds: jest.fn(),
    };

    eventLogger = {
      log: jest.fn().mockResolvedValue(true),
    };

    notificationService = {
      sendNotification: jest.fn().mockResolvedValue(undefined),
      notifyUser: jest.fn().mockResolvedValue(undefined),
      createNotification: jest.fn().mockResolvedValue(undefined),
      sendSystemAlert: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChangeRequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccessPolicyService, useValue: accessPolicy },
        { provide: EventLoggerService, useValue: eventLogger },
        { provide: NotificationEventService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<ChangeRequestsService>(ChangeRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getHierarchySummary', () => {
    it('employee can view own hierarchy summary', async () => {
      const targetUser = { id: 'user1', role: { name: 'EMPLOYEE' } };
      prisma.user.findUnique.mockResolvedValueOnce(targetUser);
      prisma.user.findMany.mockResolvedValueOnce([]); // peopleReportingToMe

      accessPolicy.roleName.mockReturnValue('EMPLOYEE');

      const res = await service.getHierarchySummary('user1', { id: 'user1', role: { name: 'EMPLOYEE' } });
      expect(res.role).toBe('EMPLOYEE');
    });

    it('manager can view scoped user hierarchy summary', async () => {
      const targetUser = { id: 'user2', departmentId: 'dept1', role: { name: 'EMPLOYEE' } };
      prisma.user.findUnique.mockResolvedValueOnce(targetUser);
      prisma.user.findMany.mockResolvedValueOnce([]); // peopleReportingToMe

      const requester = { id: 'mgr1', role: { name: 'MANAGER' } };
      accessPolicy.managedDepartmentIds.mockResolvedValue(['dept1']);

      const res = await service.getHierarchySummary('user2', requester);
      expect(res.role).toBe('EMPLOYEE');
    });

    it('employee cannot view unrelated user hierarchy summary', async () => {
      const targetUser = { id: 'user2', departmentId: 'dept1', role: { name: 'EMPLOYEE' } };
      prisma.user.findUnique.mockResolvedValueOnce(targetUser);
      const requester = { id: 'user1', role: { name: 'EMPLOYEE' } };

      await expect(service.getHierarchySummary('user2', requester)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createChangeRequest', () => {
    it('employee can create change request', async () => {
      const requester = { id: 'user1', role: { name: 'EMPLOYEE' } };
      prisma.employeeProfileChangeRequest.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockImplementation((args) => {
        if (args.where.id === 'user1') return Promise.resolve({ id: 'user1', role: { name: 'EMPLOYEE' } });
        return Promise.resolve(null);
      });
      accessPolicy.roleName.mockReturnValue('EMPLOYEE');
      prisma.employeeProfileChangeRequest.create.mockResolvedValue({ id: 'req1' });

      const dto = { requestType: 'DESIGNATION_CHANGE', changes: [{ field: 'designation', newValue: 'Senior' }] };
      const res = await service.createChangeRequest('user1', dto, requester);
      expect(res.id).toBe('req1');
      expect(prisma.employeeProfileChangeRequest.create).toHaveBeenCalled();
    });

    it('duplicate pending request rejected', async () => {
      const requester = { id: 'user1', role: { name: 'EMPLOYEE' } };
      prisma.employeeProfileChangeRequest.findFirst.mockResolvedValue({
        changes: [{ field: 'designation' }],
      });
      accessPolicy.roleName.mockReturnValue('EMPLOYEE');

      const dto = { requestType: 'DESIGNATION_CHANGE', changes: [{ field: 'designation', newValue: 'Senior' }] };
      await expect(service.createChangeRequest('user1', dto, requester)).rejects.toThrow(ConflictException);
    });

    it('employee request routes to TL first if TL exists', async () => {
      const requester = { id: 'user1', role: { name: 'EMPLOYEE' } };
      prisma.employeeProfileChangeRequest.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockImplementation((args) => {
        if (args.where.id === 'user1') return Promise.resolve({ id: 'user1', teamLeadName: 'TL123', role: { name: 'EMPLOYEE' } });
        if (args.where.employeeId === 'TL123') return Promise.resolve({ id: 'tlId' });
        return Promise.resolve(null);
      });
      accessPolicy.roleName.mockReturnValue('EMPLOYEE');
      
      prisma.employeeProfileChangeRequest.create.mockImplementation((args) => Promise.resolve(args.data));

      const dto = { requestType: 'DESIGNATION_CHANGE', changes: [{ field: 'designation', newValue: 'Senior' }] };
      const res: any = await service.createChangeRequest('user1', dto, requester);
      
      expect(res.status).toBe('PENDING_TL_APPROVAL');
      expect(res.currentApproverId).toBe('tlId');
    });

    it('employee request routes to Manager if no TL', async () => {
      const requester = { id: 'user1', role: { name: 'EMPLOYEE' } };
      prisma.employeeProfileChangeRequest.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockImplementation((args) => {
        if (args.where.id === 'user1') return Promise.resolve({ id: 'user1', reportingManager: 'MGR123', role: { name: 'EMPLOYEE' } });
        if (args.where.employeeId === 'MGR123') return Promise.resolve({ id: 'mgrId' });
        return Promise.resolve(null);
      });
      accessPolicy.roleName.mockReturnValue('EMPLOYEE');
      
      prisma.employeeProfileChangeRequest.create.mockImplementation((args) => Promise.resolve(args.data));

      const dto = { requestType: 'DESIGNATION_CHANGE', changes: [{ field: 'designation', newValue: 'Senior' }] };
      const res: any = await service.createChangeRequest('user1', dto, requester);
      
      expect(res.status).toBe('PENDING_MANAGER_APPROVAL');
      expect(res.currentApproverId).toBe('mgrId');
    });

    it('employee request escalates to Admin if no manager', async () => {
      const requester = { id: 'user1', role: { name: 'EMPLOYEE' } };
      prisma.employeeProfileChangeRequest.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockImplementation((args) => {
        if (args.where.id === 'user1') return Promise.resolve({ id: 'user1', role: { name: 'EMPLOYEE' } });
        return Promise.resolve(null);
      });
      accessPolicy.roleName.mockReturnValue('EMPLOYEE');
      
      prisma.employeeProfileChangeRequest.create.mockImplementation((args) => Promise.resolve(args.data));

      const dto = { requestType: 'DESIGNATION_CHANGE', changes: [{ field: 'designation', newValue: 'Senior' }] };
      const res: any = await service.createChangeRequest('user1', dto, requester);
      
      expect(res.status).toBe('PENDING_ADMIN_APPROVAL');
      expect(res.currentApproverId).toBe(null);
    });
  });

  describe('approveChangeRequest', () => {
    it('TL approval moves request to Manager approval', async () => {
      const tl = { id: 'tlId' };
      const request = { id: 'req1', targetUserId: 'user1', status: 'PENDING_TL_APPROVAL', currentApproverId: 'tlId', changes: [{ field: 'role', newValue: 'manager' }] };
      prisma.employeeProfileChangeRequest.findUnique.mockResolvedValue(request);
      accessPolicy.roleName.mockReturnValue('TEAM_LEAD');
      prisma.user.findUnique.mockImplementation((args) => {
        if (args.where.id === 'user1') return Promise.resolve({ id: 'user1', reportingManager: 'MGR123' });
        if (args.where.employeeId === 'MGR123') return Promise.resolve({ id: 'mgrId' });
        return Promise.resolve(null);
      });
      prisma.employeeProfileChangeRequest.update.mockImplementation((args: any) => Promise.resolve({ ...request, ...args.data }));

      const res = await service.approveChangeRequest('req1', tl);
      expect(res.status).toBe('PENDING_MANAGER_APPROVAL');
      expect(res.currentApproverId).toBe('mgrId');
    });

    it('Manager approval finalizes normal employee request and updates User', async () => {
      const mgr = { id: 'mgrId' };
      const request = { id: 'req1', targetUserId: 'user1', status: 'PENDING_MANAGER_APPROVAL', currentApproverId: 'mgrId', changes: [{field: 'designation', newValue: 'Sr Dev'}] };
      prisma.employeeProfileChangeRequest.findUnique.mockResolvedValue(request);
      accessPolicy.roleName.mockReturnValue('MANAGER');
      prisma.employeeProfileChangeRequest.update.mockImplementation((args: any) => Promise.resolve({ ...request, ...args.data }));

      const res = await service.approveChangeRequest('req1', mgr);
      expect(res.status).toBe('APPROVED');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user1' },
        data: { designation: 'Sr Dev' },
      });
    });

    it('unauthorized approver cannot approve', async () => {
      const otherUser = { id: 'otherId' };
      const request = { id: 'req1', targetUserId: 'user1', status: 'PENDING_MANAGER_APPROVAL', currentApproverId: 'mgrId' };
      prisma.employeeProfileChangeRequest.findUnique.mockResolvedValue(request);
      accessPolicy.roleName.mockReturnValue('MANAGER'); // role doesn't matter if not admin/superadmin and ID mismatch

      await expect(service.approveChangeRequest('req1', otherUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancelChangeRequest', () => {
    it('cancel works only for requester while pending', async () => {
      const request = { id: 'req1', targetUserId: 'user1', requestedById: 'user1', status: 'PENDING_TL_APPROVAL' };
      prisma.employeeProfileChangeRequest.findUnique.mockResolvedValue(request);
      prisma.employeeProfileChangeRequest.update.mockImplementation((args: any) => Promise.resolve({ ...request, ...args.data }));

      const res = await service.cancelChangeRequest('req1', 'user1');
      expect(res.status).toBe('CANCELLED');

      await expect(service.cancelChangeRequest('req1', 'otherId')).rejects.toThrow(ForbiddenException);
    });
  });
});
