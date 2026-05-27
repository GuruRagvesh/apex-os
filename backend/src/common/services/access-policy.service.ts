import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES } from '../../shared/constants/roles';

type UserLike = {
  id: string;
  role?: { name?: string; level?: number } | string;
  departmentId?: string | null;
  isHR?: boolean;
};

const SENSITIVE_USER_FIELDS = [
  'password',
  'ctcAnnual',
  'basicSalary',
  'salaryStructure',
  'bankName',
  'accountNumber',
  'ifscCode',
  'accountHolderName',
  'paymentMode',
  'panNumber',
  'aadhaarNumber',
  'uanNumber',
  'pfApplicable',
  'esicApplicable',
  'professionalTax',
  'taxRegime',
  'hrNotes',
  'employeeDocuments',
];

@Injectable()
export class AccessPolicyService {
  constructor(private prisma: PrismaService) {}

  roleName(user?: UserLike | null): string {
    const role = user?.role as any;
    return typeof role === 'string' ? role : role?.name ?? '';
  }

  isAdmin(user?: UserLike | null): boolean {
    return [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(this.roleName(user) as any);
  }

  isSuperAdmin(user?: UserLike | null): boolean {
    return this.roleName(user) === ROLES.SUPER_ADMIN;
  }

  isHrOrAdmin(user?: UserLike | null): boolean {
    return Boolean(user?.isHR) || this.isAdmin(user);
  }

  async hydrateUser(user: UserLike | string): Promise<any> {
    const id = typeof user === 'string' ? user : user.id;
    return this.prisma.user.findUnique({
      where: { id },
      include: { role: true, department: true },
    });
  }

  async managedDepartmentIds(user?: UserLike | null): Promise<string[]> {
    if (!user?.id) return [];
    const roleName = this.roleName(user);
    if (this.isAdmin(user)) return [];

    if (roleName === ROLES.MANAGER) {
      const access = await this.prisma.managerDeptAccess.findMany({
        where: { managerId: user.id },
        select: { departmentId: true },
      });
      const ids = access.map((row) => row.departmentId);
      if (user.departmentId) ids.push(user.departmentId);
      return [...new Set(ids)];
    }

    if (roleName === ROLES.TEAM_LEAD && user.departmentId) {
      return [user.departmentId];
    }

    return user.departmentId ? [user.departmentId] : [];
  }

  async canViewUser(requester: UserLike, target: any): Promise<boolean> {
    if (!requester?.id || !target) return false;
    if (this.isHrOrAdmin(requester)) return true;
    if (requester.id === target.id) return true;

    const roleName = this.roleName(requester);
    if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) {
      const deptIds = await this.managedDepartmentIds(requester);
      return Boolean(target.departmentId && deptIds.includes(target.departmentId));
    }

    return false;
  }

  canViewPayroll(requester: UserLike, target: any): boolean {
    if (!requester?.id || !target) return false;
    return this.isHrOrAdmin(requester) || requester.id === target.id;
  }

  canEditPayroll(requester: UserLike): boolean {
    return this.isHrOrAdmin(requester);
  }

  canViewDocuments(requester: UserLike, target: any): boolean {
    if (!requester?.id || !target) return false;
    return this.isHrOrAdmin(requester) || requester.id === target.id;
  }

  canUploadDocuments(requester: UserLike, target: any): boolean {
    if (!requester?.id || !target) return false;
    return this.isHrOrAdmin(requester) || requester.id === target.id;
  }

  canVerifyDocuments(requester: UserLike): boolean {
    return this.isHrOrAdmin(requester);
  }

  assertAllowed(allowed: boolean, message = 'You do not have permission to perform this action'): void {
    if (!allowed) throw new ForbiddenException(message);
  }

  safeUser(user: any): any {
    if (!user) return user;
    const sanitized = { ...user };
    for (const field of SENSITIVE_USER_FIELDS) delete sanitized[field];
    return sanitized;
  }

  maskPayrollForSelf(user: any): any {
    const sanitized = { ...user };
    delete sanitized.password;
    delete sanitized.employeeDocuments;
    if (sanitized.accountNumber) {
      sanitized.accountNumber = '********' + String(sanitized.accountNumber).slice(-4);
    }
    if (sanitized.aadhaarNumber) {
      sanitized.aadhaarNumber = 'XXXX-XXXX-' + String(sanitized.aadhaarNumber).slice(-4);
    }
    if (sanitized.panNumber && String(sanitized.panNumber).length >= 5) {
      const pan = String(sanitized.panNumber);
      sanitized.panNumber = pan.slice(0, 2) + '*****' + pan.slice(-3);
    }
    return sanitized;
  }

  stripPayroll(user: any): any {
    return this.safeUser(user);
  }
}
