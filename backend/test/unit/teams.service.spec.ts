import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TeamsService } from '../../src/modules/operations/team/teams.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';

const prisma: any = {
  team: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  teamMember: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  department: { findUnique: jest.fn() },
  userDepartmentMembership: { findUnique: jest.fn() },
  ticket: { count: jest.fn() },
  userRoleAssignment: { count: jest.fn() },
  managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
};

const admin = { id: 'admin1', role: { name: 'ADMIN' } };
const manager = (departmentId: string | null = null) => ({ id: 'mgr1', role: { name: 'MANAGER' }, departmentId });
const employee = (id = 'emp1') => ({ id, role: { name: 'EMPLOYEE' }, departmentId: 'd1' });

describe('TeamsService', () => {
  let service: TeamsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.managerDeptAccess.findMany.mockResolvedValue([]);
    service = new TeamsService(prisma, new AccessPolicyService(prisma));
  });

  describe('create', () => {
    it('creates a team for an admin', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'd1' });
      prisma.team.findFirst.mockResolvedValue(null);
      prisma.team.create.mockResolvedValue({ id: 't1', name: 'Frontend', departmentId: 'd1' });

      const result = await service.create({ name: 'Frontend', departmentId: 'd1' } as any, admin);

      expect(result).toEqual({ id: 't1', name: 'Frontend', departmentId: 'd1' });
      expect(prisma.team.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'Frontend', departmentId: 'd1', teamLeadId: undefined } }),
      );
    });

    it('rejects when department does not exist', async () => {
      prisma.department.findUnique.mockResolvedValue(null);

      await expect(service.create({ name: 'X', departmentId: 'missing' } as any, admin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects duplicate team name within the same department', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'd1' });
      prisma.team.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.create({ name: 'Frontend', departmentId: 'd1' } as any, admin)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a teamLeadId whose role has no leadership level', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'd1' });
      prisma.team.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: { name: 'EMPLOYEE' } });

      await expect(
        service.create({ name: 'Frontend', departmentId: 'd1', teamLeadId: 'u1' } as any, admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks a manager from creating a team outside their managed departments', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'd1' });
      prisma.managerDeptAccess.findMany.mockResolvedValue([]);

      await expect(
        service.create({ name: 'Frontend', departmentId: 'd1' } as any, manager('d2')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a manager with ManagerDeptAccess to the target department', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'd1' });
      prisma.managerDeptAccess.findMany.mockResolvedValue([{ departmentId: 'd1' }]);
      prisma.team.findFirst.mockResolvedValue(null);
      prisma.team.create.mockResolvedValue({ id: 't1', name: 'Frontend', departmentId: 'd1' });

      await expect(
        service.create({ name: 'Frontend', departmentId: 'd1' } as any, manager('d2')),
      ).resolves.toEqual({ id: 't1', name: 'Frontend', departmentId: 'd1' });
    });
  });

  describe('remove', () => {
    it('blocks deletion when the team still has members', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 't1', departmentId: 'd1', _count: { members: 2 } });

      await expect(service.remove('t1', admin)).rejects.toThrow(ConflictException);
      expect(prisma.team.delete).not.toHaveBeenCalled();
    });

    it('blocks deletion when tickets still reference the team', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 't1', departmentId: 'd1', _count: { members: 0 } });
      prisma.ticket.count.mockResolvedValue(3);
      prisma.userRoleAssignment.count.mockResolvedValue(0);

      await expect(service.remove('t1', admin)).rejects.toThrow(ConflictException);
      expect(prisma.team.delete).not.toHaveBeenCalled();
    });

    it('deletes a clean team with no members, tickets, or role assignments', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 't1', departmentId: 'd1', _count: { members: 0 } });
      prisma.ticket.count.mockResolvedValue(0);
      prisma.userRoleAssignment.count.mockResolvedValue(0);
      prisma.team.delete.mockResolvedValue({});

      await expect(service.remove('t1', admin)).resolves.toEqual({ success: true });
      expect(prisma.team.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });
  });

  describe('addMember', () => {
    it('rejects adding a user who is not a member of the team department', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 't1', departmentId: 'd1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', departmentId: 'd2' });
      prisma.teamMember.findUnique.mockResolvedValue(null);
      prisma.userDepartmentMembership.findUnique.mockResolvedValue(null);

      await expect(service.addMember('t1', { userId: 'u1' } as any, admin)).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate membership', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 't1', departmentId: 'd1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', departmentId: 'd1' });
      prisma.teamMember.findUnique.mockResolvedValue({ id: 'm1' });

      await expect(service.addMember('t1', { userId: 'u1' } as any, admin)).rejects.toThrow(ConflictException);
    });

    it('adds a member who belongs to the team department', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 't1', departmentId: 'd1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', departmentId: 'd1' });
      prisma.teamMember.findUnique.mockResolvedValue(null);
      prisma.teamMember.create.mockResolvedValue({ id: 'm1', teamId: 't1', userId: 'u1' });

      await expect(service.addMember('t1', { userId: 'u1' } as any, admin)).resolves.toEqual({
        id: 'm1',
        teamId: 't1',
        userId: 'u1',
      });
    });
  });

  describe('update', () => {
    it('clears the team lead when teamLeadId is explicitly null', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 't1', departmentId: 'd1', name: 'Frontend' });
      prisma.team.update.mockResolvedValue({ id: 't1', name: 'Frontend', teamLeadId: null });

      await service.update('t1', { teamLeadId: null } as any, admin);

      expect(prisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { teamLeadId: null } }),
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('leaves teamLeadId untouched when omitted from the DTO', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 't1', departmentId: 'd1', name: 'Frontend' });
      prisma.team.update.mockResolvedValue({ id: 't1', name: 'Renamed' });

      await service.update('t1', { name: 'Renamed' } as any, admin);

      expect(prisma.team.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Renamed' } }));
    });
  });

  describe('removeMember', () => {
    it('blocks removing the current team lead', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 't1', departmentId: 'd1', teamLeadId: 'lead1' });

      await expect(service.removeMember('t1', 'lead1', admin)).rejects.toThrow(ConflictException);
      expect(prisma.teamMember.delete).not.toHaveBeenCalled();
    });

    it('removes a regular member who is not the team lead', async () => {
      prisma.team.findUnique.mockResolvedValue({ id: 't1', departmentId: 'd1', teamLeadId: 'lead1' });
      prisma.teamMember.findUnique.mockResolvedValue({ id: 'm1' });
      prisma.teamMember.delete.mockResolvedValue({});

      await expect(service.removeMember('t1', 'member1', admin)).resolves.toEqual({ success: true });
      expect(prisma.teamMember.delete).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: 't1', userId: 'member1' } },
      });
    });
  });

  describe('findAll scoping', () => {
    it('scopes results to teams the user leads or belongs to for non-admin, non-manager roles', async () => {
      prisma.team.findMany.mockResolvedValue([]);

      await service.findAll(employee());

      expect(prisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ teamLeadId: 'emp1' }, { members: { some: { userId: 'emp1' } } }] },
        }),
      );
    });
  });

  describe('findOne access', () => {
    it('forbids viewing a team the user neither leads nor belongs to', async () => {
      prisma.team.findUnique.mockResolvedValue({
        id: 't1',
        departmentId: 'd1',
        teamLeadId: 'someone-else',
        members: [{ userId: 'other-user' }],
      });

      await expect(service.findOne('t1', employee())).rejects.toThrow(ForbiddenException);
    });
  });
});
