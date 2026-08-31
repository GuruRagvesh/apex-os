import { TVAService } from '../../src/common/services/tva.service';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../../src/modules/core/users/users.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { EmailService } from '../../src/modules/platform/email/email.service';
import { BackupVaultService } from '../../src/modules/platform/backup-vault/backup-vault.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  activityLog: {
    create: jest.fn(),
  },
};

const mockAccessPolicy = {
  isHrOrAdmin: jest.fn(),
  roleName: jest.fn(),
  canViewUser: jest.fn().mockResolvedValue(true),
  assertAllowed: jest.fn(),
  maskPayrollForSelf: jest.fn().mockImplementation((u) => u),
};

const mockEventLogger = { log: jest.fn().mockResolvedValue(undefined) };

describe('UsersService — Profile Update Scoping', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TVAService, useValue: { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(), companyDayStart: () => new Date(), formatZoned: () => 'mock', companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } },
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AccessPolicyService, useValue: mockAccessPolicy },
        { provide: EventLoggerService, useValue: mockEventLogger },
        // UsersService gained these two dependencies; without them the module
        // failed to compile and this ENTIRE suite never ran a single
        // assertion -- which is how the profile mass-assignment bug it was
        // written to catch reached production.
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: BackupVaultService, useValue: { save: jest.fn() } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('updates only database schema columns and strips relations/invalid fields', async () => {
    const requester = { id: 'admin1', role: { name: 'ADMIN' } };
    const targetUser = { id: 'user1', name: 'Original Name', roleId: 'emp' };

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(requester)
      .mockResolvedValueOnce(targetUser);

    mockPrisma.user.update.mockResolvedValue({ id: 'user1', name: 'New Name' });

    // Request payload contains relation objects and invalid fields
    const dto = {
      name: 'New Name',
      role: { id: 'admin-role', name: 'ADMIN' },
      department: { id: 'it-dept' },
      invalidField: 'trash',
      joiningDate: '2026-06-01',
    };

    await service.updateProfile('admin1', 'user1', dto);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: {
        name: 'New Name',
        joiningDate: new Date('2026-06-01'),
      },
      include: { role: true, department: true },
    });
  });

  it('allows self-updates only for allowed personal fields', async () => {
    const requester = { id: 'user1', role: { name: 'EMPLOYEE' } };
    const targetUser = { id: 'user1', name: 'User 1' };

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(requester)
      .mockResolvedValueOnce(targetUser);

    mockPrisma.user.update.mockResolvedValue({ id: 'user1' });

    // User tries to change password and CTC
    const dto = {
      name: 'New Self Name',
      password: 'hacked-password',
      ctcAnnual: '1000000',
    };

    await service.updateProfile('user1', 'user1', dto);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: {
        name: 'New Self Name',
      },
      include: { role: true, department: true },
    });
  });
});
