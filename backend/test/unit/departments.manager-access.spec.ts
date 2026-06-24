import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DepartmentsService } from '../../src/modules/core/departments/departments.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';

describe('DepartmentsService — DMM-2 manager assignment (ManagerDeptAccess)', () => {
  let prisma: any;
  let service: DepartmentsService;

  beforeEach(() => {
    prisma = {
      department: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      managerDeptAccess: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
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
    it('returns active managers mapped with accessLevel, excludes inactive via the where clause', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1' });
      prisma.managerDeptAccess.findMany.mockResolvedValue([
        { accessLevel: 'FULL', manager: { id: 'user-1', name: 'Subrat', isActive: true, role: { name: 'MANAGER' } } },
      ]);

      const result = await service.getManagers('dept-1');

      expect(prisma.managerDeptAccess.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { departmentId: 'dept-1', manager: { isActive: true } } }),
      );
      expect(result).toEqual([{ id: 'user-1', name: 'Subrat', isActive: true, role: { name: 'MANAGER' }, accessLevel: 'FULL' }]);
    });

    it('throws NotFoundException if the department does not exist', async () => {
      prisma.department.findUnique.mockResolvedValue(null);

      await expect(service.getManagers('missing-dept')).rejects.toThrow(NotFoundException);
    });
  });
});
