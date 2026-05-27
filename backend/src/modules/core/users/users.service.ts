import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private accessPolicy: AccessPolicyService,
  ) {}

  async findAll(query: { search?: string; departmentId?: string; roleId?: string; page?: number; limit?: number }, requester?: any) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.roleId) where.roleId = query.roleId;

    if (requester && !this.accessPolicy.isHrOrAdmin(requester)) {
      const roleName = this.accessPolicy.roleName(requester);
      if (['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
        const deptIds = await this.accessPolicy.managedDepartmentIds(requester);
        if (deptIds.length > 0) where.departmentId = { in: deptIds };
        else where.id = requester.id;
      } else {
        where.id = requester.id;
      }
    }

    const [total, rawUsers] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: { role: true, department: true },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    const users = rawUsers.map((u) => this.accessPolicy.safeUser(u));
    return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, requester?: any) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true, department: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (requester) {
      this.accessPolicy.assertAllowed(
        await this.accessPolicy.canViewUser(requester, user),
        'You do not have permission to view this user',
      );
    }
    return this.accessPolicy.safeUser(user);
  }

  async create(data: { name: string; email: string; password: string; roleId: string; departmentId?: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictException('Email already registered');

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: { ...data, password: hashedPassword },
      include: { role: true, department: true },
    });
    const { password, ...result } = user;
    return result;
  }

  async update(id: string, data: { name?: string; email?: string; roleId?: string; departmentId?: string; isActive?: boolean; avatar?: string; photoUrl?: string | null; bio?: string }) {
    const user = await this.prisma.user.update({
      where: { id },
      data,
      include: { role: true, department: true },
    });
    const { password, ...result } = user;
    return result;
  }

  async uploadPhoto(userId: string, file: Express.Multer.File): Promise<{ photoUrl: string }> {
    const photoUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    await this.prisma.user.update({ where: { id: userId }, data: { photoUrl } });
    return { photoUrl };
  }

  async resetPassword(id: string, newPassword: string) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id }, data: { password: hashedPassword } });
    return { message: 'Password reset successfully' };
  }

  async remove(id: string) {
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    return { message: 'User deactivated' };
  }

  async getMyTeam(userId: string, roleName: string) {
    const me = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!me) return [];

    // Managers see all users in their managed departments
    if (roleName === 'MANAGER') {
      const managedAccess = await (this.prisma as any).managerDeptAccess.findMany({
        where: { managerId: userId },
        select: { departmentId: true },
      });
      const deptIds: string[] = managedAccess.map((a: any) => a.departmentId as string);
      if (me.departmentId) deptIds.push(me.departmentId);
      const uniqueDeptIds: string[] = [...new Set(deptIds)];
      if (uniqueDeptIds.length === 0) return [];
      // Manually filter by dept since findAll doesn't support multi-dept
      const users = await this.prisma.user.findMany({
        where: { departmentId: { in: uniqueDeptIds }, isActive: true, id: { not: userId } },
        include: { role: true, department: true },
        orderBy: { name: 'asc' },
      });
      return users.map((u) => this.accessPolicy.safeUser(u));
    }

    // Team Lead / Employee → same department
    if (!me.departmentId) return [];
    const users = await this.prisma.user.findMany({
      where: { departmentId: me.departmentId, isActive: true, id: { not: userId } },
      include: { role: true, department: true },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => this.accessPolicy.safeUser(u));
  }

  async getDirectory(requester?: any) {
    // Fetch all active users with role + dept
    const where: any = { isActive: true };
    if (requester && !this.accessPolicy.isHrOrAdmin(requester)) {
      const deptIds = await this.accessPolicy.managedDepartmentIds(requester);
      if (deptIds.length > 0) where.departmentId = { in: deptIds };
      else where.id = requester.id;
    }
    const users = await this.prisma.user.findMany({
      where,
      include: { role: true, department: true },
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
    });

    // Open ticket counts per user (single query)
    const openCounts = await this.prisma.ticket.groupBy({
      by: ['assignedToId'],
      where: {
        assignedToId: { not: null },
        status: { notIn: ['DONE', 'CLOSED'] },
      },
      _count: { id: true },
    });
    const countMap: Record<string, number> = {};
    openCounts.forEach((r) => { if (r.assignedToId) countMap[r.assignedToId] = r._count.id; });

    return users.map((u) => ({
      ...this.accessPolicy.safeUser(u),
      ticketCount: countMap[u.id] ?? 0,
    }));
  }

  async getStats() {
    const [total, active, byRole, byDept] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.groupBy({ by: ['roleId'], _count: true }),
      this.prisma.user.groupBy({ by: ['departmentId'], _count: true }),
    ]);
    return { total, active, inactive: total - active, byRole, byDept };
  }

  private async logSensitiveAccess(requesterId: string, action: string, targetUserId: string, details?: object) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: requesterId,
          action,
          entityType: 'User',
          entityId: targetUserId,
          details: details ?? {},
        },
      });
    } catch (e) {
      console.warn('[AUDIT] Could not log sensitive access:', action, e);
    }
  }

  async getProfile(requesterId: string, targetUserId: string) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      include: { role: true, department: true },
    });
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { role: true, department: true, employeeDocuments: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (!requester) throw new ForbiddenException('Not authorized');
    this.accessPolicy.assertAllowed(
      await this.accessPolicy.canViewUser(requester, target),
      'You do not have permission to view this profile',
    );

    const roleName = (requester?.role as any)?.name ?? '';
    const isHR = (requester as any)?.isHR;
    const canSeeFull = ['SUPER_ADMIN', 'ADMIN'].includes(roleName) || isHR;
    const isOwnProfile = requesterId === targetUserId;
    const managerDeptIds = roleName === 'MANAGER' ? await this.accessPolicy.managedDepartmentIds(requester) : [];
    const isManagerOfDept = roleName === 'MANAGER' && Boolean(target.departmentId && managerDeptIds.includes(target.departmentId));
    const isTeamLead = roleName === 'TEAM_LEAD' && requester?.departmentId === target.departmentId;

    if (canSeeFull) {
      await this.logSensitiveAccess(requesterId, 'VIEW_PAYROLL_DATA', targetUserId);
      const { password, employeeDocuments, ...result } = target as any;
      return result;
    }

    if (isOwnProfile) {
      return this.accessPolicy.maskPayrollForSelf(target as any);
    }

    if (isManagerOfDept) {
      const { password, ctcAnnual, basicSalary, accountNumber, panNumber, aadhaarNumber, uanNumber,
        bankName, ifscCode, accountHolderName, salaryStructure, pfApplicable, esicApplicable,
        professionalTax, taxRegime, hrNotes, ...rest } = target as any;
      return rest;
    }

    if (isTeamLead) {
      return {
        id: target.id, name: target.name, email: target.email, avatar: target.avatar,
        phone: (target as any).phone, designation: (target as any).designation, department: (target as any).department,
        role: target.role, workMode: (target as any).workMode, shiftTiming: (target as any).shiftTiming,
        employmentType: (target as any).employmentType, joiningDate: (target as any).joiningDate,
      };
    }

    // Default: public fields only
    return {
      id: target.id, name: target.name, email: target.email,
      avatar: target.avatar, role: target.role, department: (target as any).department,
      designation: (target as any).designation,
    };
  }

  async updateProfile(requesterId: string, targetUserId: string, dto: any) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      include: { role: true },
    });
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, include: { role: true, department: true } });
    if (!target) throw new NotFoundException('User not found');
    if (!requester) throw new ForbiddenException('Not authorized');
    const roleName = (requester?.role as any)?.name ?? '';
    const isHR = (requester as any)?.isHR;
    const canEditAll = ['SUPER_ADMIN', 'ADMIN'].includes(roleName) || isHR;
    const isOwnProfile = requesterId === targetUserId;

    const PAYROLL_FIELDS = ['ctcAnnual','basicSalary','salaryStructure','bankName',
      'accountNumber','ifscCode','accountHolderName','paymentMode','panNumber',
      'aadhaarNumber','uanNumber','pfApplicable','esicApplicable','professionalTax','taxRegime'];

    const PERSONAL_EDITABLE_BY_SELF = ['name','phone','currentAddress','permanentAddress',
      'emergencyName','emergencyPhone','emergencyRelation','userLocation','bloodGroup',
      'gender','dateOfBirth'];

    let data: any = {};

    if (canEditAll) {
      data = { ...dto };
      delete data.password;
      delete data.id;
      const payrollChanged = PAYROLL_FIELDS.filter((f) => f in dto);
      if (payrollChanged.length > 0) {
        await this.logSensitiveAccess(requesterId, 'EDIT_PAYROLL_DATA', targetUserId, { fieldsChanged: payrollChanged });
      }
    } else if (isOwnProfile) {
      for (const key of PERSONAL_EDITABLE_BY_SELF) {
        if (key in dto) data[key] = dto[key];
      }
    } else {
      throw new ForbiddenException('Not authorized to edit this profile');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data,
      include: { role: true, department: true },
    });
    const { password, ...result } = updated as any;
    return result;
  }

  async uploadDocument(requesterId: string, targetUserId: string, file: Express.Multer.File, documentType: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId }, include: { role: true } });
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, include: { role: true, department: true } });
    if (!target) throw new NotFoundException('User not found');
    if (!requester) throw new ForbiddenException('Not authorized');

    this.accessPolicy.assertAllowed(
      this.accessPolicy.canUploadDocuments(requester, target),
      'Cannot upload documents for this user',
    );

    const fileUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

    const doc = await (this.prisma as any).employeeDocument.create({
      data: {
        userId: targetUserId,
        documentType,
        fileName: file.originalname,
        fileUrl,
        fileSize: file.size,
        mimeType: file.mimetype,
        verificationStatus: 'Pending',
      },
    });
    return { document: doc };
  }

  async verifyDocument(requesterId: string, userId: string, docId: string, status: string, rejectionReason?: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId }, include: { role: true } });
    if (!requester) throw new ForbiddenException('Not authorized');

    this.accessPolicy.assertAllowed(
      this.accessPolicy.canVerifyDocuments(requester),
      'Only HR/Admin can verify documents',
    );

    const existing = await (this.prisma as any).employeeDocument.findFirst({
      where: { id: docId, userId },
    });
    if (!existing) throw new NotFoundException('Document not found');

    const doc = await (this.prisma as any).employeeDocument.update({
      where: { id: docId },
      data: {
        verificationStatus: status,
        verifiedBy: requester?.name,
        verifiedAt: new Date(),
        rejectionReason: status === 'REJECTED' ? rejectionReason : null,
      },
    });

    await this.logSensitiveAccess(requesterId, status === 'VERIFIED' ? 'DOCUMENT_VERIFIED' : 'DOCUMENT_REJECTED', userId, { docId });
    return { document: doc };
  }

  async getDocuments(requesterId: string, targetUserId: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId }, include: { role: true } });
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, include: { role: true, department: true } });
    if (!target) throw new NotFoundException('User not found');
    if (!requester) throw new ForbiddenException('Not authorized');

    this.accessPolicy.assertAllowed(
      this.accessPolicy.canViewDocuments(requester, target),
      'Not authorized to view documents',
    );

    return (this.prisma as any).employeeDocument.findMany({
      where: { userId: targetUserId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  // ── Per-user preferences (notification + ticket defaults) ─────────────────
  // Stored in AppSetting with key `user-prefs-{userId}` — no schema migration needed.

  async getPreferences(userId: string): Promise<any> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: `user-prefs-${userId}` },
    });
    return row ? (row.value as any) : {};
  }

  async savePreferences(userId: string, prefs: any): Promise<any> {
    const saved = await this.prisma.appSetting.upsert({
      where: { key: `user-prefs-${userId}` },
      create: { key: `user-prefs-${userId}`, value: prefs, updatedBy: userId },
      update: { value: prefs, updatedBy: userId },
    });
    return saved.value;
  }
}
