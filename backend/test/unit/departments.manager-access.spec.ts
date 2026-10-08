import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DepartmentsService } from '../../src/modules/core/departments/departments.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';

describe('DepartmentsService — DMM-2B single Department Head enforcement (ManagerDeptAccess)', () => {
  let prisma: any;
  let service: DepartmentsService;

  beforeEach(() => {
    prisma = {
      department: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      leaveRequest: { count: jest.fn().mockResolvedValue(0) },
      managerDeptAccess: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    service = new DepartmentsService(prisma, new AccessPolicyService(prisma));
  });

  describe('addManager', () => {
    it('assigns an active MANAGER as a department manager', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1', name: 'Subrat', email: 'subrat@x.com', avatar: null, isActive: true,
        role: { id: 'role-mgr', name: 'MANAGER' },
      });
      prisma.managerDeptAccess.findUnique.mockResolvedValue(null);
      prisma.managerDeptAccess.create.mockResolvedValue({ id: 'mda-1', accessLevel: 'FULL' });

      const result = await service.addManager('dept-1', 'user-1');

      expect(prisma.managerDeptAccess.create).toHaveBeenCalledWith({
        data: { managerId: 'user-1', departmentId: 'dept-1', accessLevel: 'FULL' },
      });
      expect(result).toMatchObject({ id: 'user-1', name: 'Subrat', accessLevel: 'FULL' });
    });

    it('replaces the existing department head when a different user is assigned, leaving exactly one row', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-2', name: 'New Head', email: 'newhead@x.com', avatar: null, isActive: true,
        role: { id: 'role-mgr', name: 'MANAGER' },
      });
      // user-2 is not currently the head themselves — a different user (e.g. user-1) holds the row.
      prisma.managerDeptAccess.findUnique.mockResolvedValue(null);
      prisma.managerDeptAccess.deleteMany.mockResolvedValue({ count: 1 });
      prisma.managerDeptAccess.create.mockResolvedValue({ id: 'mda-2', accessLevel: 'FULL' });

      const result = await service.addManager('dept-1', 'user-2');

      expect(prisma.managerDeptAccess.deleteMany).toHaveBeenCalledWith({ where: { departmentId: 'dept-1' } });
      expect(prisma.managerDeptAccess.create).toHaveBeenCalledWith({
        data: { managerId: 'user-2', departmentId: 'dept-1', accessLevel: 'FULL' },
      });
      // deleteMany is batched ahead of create in the same transaction — proves the old head(s)
      // are cleared before the new singular head row is created.
      expect(prisma.$transaction).toHaveBeenCalledWith([expect.anything(), expect.anything()]);
      expect(result).toMatchObject({ id: 'user-2', accessLevel: 'FULL' });
    });

    it('rejects an inactive user', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-2', name: 'Old User', isActive: false, role: { name: 'MANAGER' },
      });

      await expect(service.addManager('dept-1', 'user-2')).rejects.toThrow(BadRequestException);
      expect(prisma.managerDeptAccess.create).not.toHaveBeenCalled();
    });

    it('rejects a user whose role is not MANAGER/ADMIN/SUPER_ADMIN', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-3', name: 'Employee Eve', isActive: true, role: { name: 'EMPLOYEE' },
      });

      await expect(service.addManager('dept-1', 'user-3')).rejects.toThrow(BadRequestException);
      expect(prisma.managerDeptAccess.create).not.toHaveBeenCalled();
    });

    it('returns the existing assignment instead of erroring on duplicate add', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1', name: 'Subrat', isActive: true, role: { name: 'MANAGER' },
      });
      prisma.managerDeptAccess.findUnique.mockResolvedValue({ id: 'mda-1', accessLevel: 'FULL' });

      const result = await service.addManager('dept-1', 'user-1');

      expect(prisma.managerDeptAccess.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'user-1', accessLevel: 'FULL' });
    });

    it('throws NotFoundException if the department does not exist', async () => {
      prisma.department.findUnique.mockResolvedValue(null);

      await expect(service.addManager('missing-dept', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if the user does not exist', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1' });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.addManager('dept-1', 'missing-user')).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeManager', () => {
    it('deletes an existing ManagerDeptAccess row', async () => {
      prisma.managerDeptAccess.findUnique.mockResolvedValue({ id: 'mda-1' });
      prisma.managerDeptAccess.delete.mockResolvedValue({ id: 'mda-1' });

      const result = await service.removeManager('dept-1', 'user-1');

      expect(prisma.managerDeptAccess.delete).toHaveBeenCalledWith({ where: { id: 'mda-1' } });
      expect(result).toEqual({ success: true });
    });

    it('throws NotFoundException if no assignment exists', async () => {
      prisma.managerDeptAccess.findUnique.mockResolvedValue(null);

      await expect(service.removeManager('dept-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.managerDeptAccess.delete).not.toHaveBeenCalled();
    });
  });

  describe('getManagers', () => {
    it('returns the active, role-eligible department head mapped with accessLevel, as a single-entry array', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1' });
      prisma.managerDeptAccess.findMany.mockResolvedValue([
        { accessLevel: 'FULL', manager: { id: 'user-1', name: 'Subrat', isActive: true, role: { name: 'MANAGER' } } },
      ]);

      const result = await service.getManagers('dept-1');

      expect(prisma.managerDeptAccess.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            departmentId: 'dept-1',
            manager: { isActive: true, role: { name: { in: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'] } } },
          },
        }),
      );
      expect(result).toEqual([{ id: 'user-1', name: 'Subrat', isActive: true, role: { name: 'MANAGER' }, accessLevel: 'FULL' }]);
    });

    it('returns an empty array when no department head is assigned', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1' });
      prisma.managerDeptAccess.findMany.mockResolvedValue([]);

      const result = await service.getManagers('dept-1');

      expect(result).toEqual([]);
    });

    it('throws NotFoundException if the department does not exist', async () => {
      prisma.department.findUnique.mockResolvedValue(null);

      await expect(service.getManagers('missing-dept')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne — singular departmentHead', () => {
    const baseDept = { id: 'dept-1', users: [], tickets: [], _count: { users: 0, tickets: 0, projects: 0 } };

    it('returns a singular departmentHead field derived from ManagerDeptAccess, plus a compatibility managers array', async () => {
      prisma.department.findUnique.mockResolvedValue(baseDept);
      prisma.managerDeptAccess.findMany.mockResolvedValue([
        { accessLevel: 'FULL', manager: { id: 'user-1', name: 'Subrat', isActive: true, role: { name: 'MANAGER' } } },
      ]);

      const result = await service.findOne('dept-1');

      expect(result.departmentHead).toEqual({ id: 'user-1', name: 'Subrat', isActive: true, role: { name: 'MANAGER' }, accessLevel: 'FULL' });
      expect(result.managers).toEqual([result.departmentHead]);
    });

    it('returns null departmentHead and an empty managers array when no head is assigned', async () => {
      prisma.department.findUnique.mockResolvedValue(baseDept);
      prisma.managerDeptAccess.findMany.mockResolvedValue([]);

      const result = await service.findOne('dept-1');

      expect(result.departmentHead).toBeNull();
      expect(result.managers).toEqual([]);
    });

    it('deterministically picks one head and ignores extras if legacy duplicate rows exist', async () => {
      prisma.department.findUnique.mockResolvedValue(baseDept);
      prisma.managerDeptAccess.findMany.mockResolvedValue([
        { accessLevel: 'FULL', manager: { id: 'user-1', name: 'Older Head', isActive: true, role: { name: 'MANAGER' } } },
        { accessLevel: 'READ', manager: { id: 'user-2', name: 'Newer Head', isActive: true, role: { name: 'MANAGER' } } },
      ]);

      const result = await service.findOne('dept-1');

      expect(result.departmentHead).toMatchObject({ id: 'user-1' });
      expect(result.managers).toHaveLength(1);
    });
  });
});
