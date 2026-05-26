import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: { search?: string; departmentId?: string; roleId?: string; page?: number; limit?: number }) {
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

    const users = rawUsers.map(({ password, ...u }) => u);
    return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true, department: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const { password, ...result } = user;
    return result;
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
      return users.map(({ password, ...u }) => u);
    }

    // Team Lead / Employee → same department
    if (!me.departmentId) return [];
    const users = await this.prisma.user.findMany({
      where: { departmentId: me.departmentId, isActive: true, id: { not: userId } },
      include: { role: true, department: true },
      orderBy: { name: 'asc' },
    });
    return users.map(({ password, ...u }) => u);
  }

  async getDirectory() {
    // Fetch all active users with role + dept
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
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

    return users.map(({ password, ...u }) => ({
      ...u,
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
      include: { role: true },
    });
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { role: true, department: true, employeeDocuments: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const roleName = (requester?.role as any)?.name ?? '';
    const isHR = (requester as any)?.isHR;
    const canSeeFull = ['SUPER_ADMIN', 'ADMIN'].includes(roleName) || isHR;
    const isOwnProfile = requesterId === targetUserId;
    const isManagerOfDept = roleName === 'MANAGER' && requester?.departmentId === target.departmentId;
    const isTeamLead = roleName === 'TEAM_LEAD' && requester?.departmentId === target.departmentId;

    if (canSeeFull) {
      await this.logSensitiveAccess(requesterId, 'VIEW_PAYROLL_DATA', targetUserId);
      const { password, ...result } = target as any;
      return result;
    }

    if (isOwnProfile) {
      const { password, ...rest } = target as any;
      const masked = { ...rest };
      if (masked.accountNumber) {
        masked.accountNumber = '••••••••' + masked.accountNumber.slice(-4);
      }
      if (masked.aadhaarNumber) {
        masked.aadhaarNumber = 'XXXX-XXXX-' + masked.aadhaarNumber.slice(-4);
      }
      if (masked.panNumber && masked.panNumber.length >= 5) {
        masked.panNumber = masked.panNumber.slice(0, 2) + '•••••' + masked.panNumber.slice(-3);
      }
      return masked;
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
    const roleName = (requester?.role as any)?.name ?? '';
    const isHR = (requester as any)?.isHR;
    const canUploadForOthers = ['SUPER_ADMIN', 'ADMIN'].includes(roleName) || isHR;

    if (requesterId !== targetUserId && !canUploadForOthers) {
      throw new ForbiddenException('Cannot upload documents for other users');
    }

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
    const roleName = (requester?.role as any)?.name ?? '';
    const isHR = (requester as any)?.isHR;

    if (!['SUPER_ADMIN', 'ADMIN'].includes(roleName) && !isHR) {
      throw new ForbiddenException('Only HR/Admin can verify documents');
    }

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
    const roleName = (requester?.role as any)?.name ?? '';
    const isHR = (requester as any)?.isHR;
    const canSeeAll = ['SUPER_ADMIN', 'ADMIN'].includes(roleName) || isHR || requesterId === targetUserId;
    const isManagerOfDept = roleName === 'MANAGER';

    if (!canSeeAll && !isManagerOfDept) {
      throw new ForbiddenException('Not authorized');
    }

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
