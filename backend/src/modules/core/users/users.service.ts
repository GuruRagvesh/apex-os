import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import * as bcrypt from 'bcryptjs';

// documentType value the Documents & Verification UI sends for a profile photo.
// Only this document type is allowed to update the user's avatar/photo.
const PROFILE_PHOTO_DOCUMENT_TYPE = 'PROFILE_PHOTO';
function isProfilePhotoType(documentType?: string): boolean {
  return (documentType ?? '').toUpperCase().replace(/[\s-]+/g, '_') === PROFILE_PHOTO_DOCUMENT_TYPE;
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private accessPolicy: AccessPolicyService,
    private eventLogger: EventLoggerService,
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

  async create(data: { name: string; email: string; password: string; roleId: string; departmentId?: string }, actorId?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictException('Email already registered');

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: { ...data, password: hashedPassword },
      include: { role: true, department: true },
    });
    this.eventLogger.log({
      actorId: actorId ?? user.id,
      entityType: 'User',
      entityId: user.id,
      action: OperationalAction.USER_CREATED,
      metadata: { name: user.name, email: user.email, roleId: user.roleId },
    }).catch(() => {});
    const { password, ...result } = user;
    return result;
  }

  async update(id: string, data: { name?: string; email?: string; roleId?: string; departmentId?: string; isActive?: boolean; avatar?: string; photoUrl?: string | null; bio?: string }, actorId?: string) {
    const user = await this.prisma.user.update({
      where: { id },
      data,
      include: { role: true, department: true },
    });
    const action = data.roleId ? OperationalAction.USER_ROLE_CHANGED : OperationalAction.USER_UPDATED;
    this.eventLogger.log({
      actorId: actorId ?? id,
      entityType: 'User',
      entityId: id,
      action,
      metadata: { fields: Object.keys(data) },
    }).catch(() => {});
    const { password, ...result } = user;
    return result;
  }

  async uploadPhoto(userId: string, file: Express.Multer.File): Promise<{ photoUrl: string }> {
    const photoUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    await this.prisma.user.update({ where: { id: userId }, data: { photoUrl } });
    this.eventLogger.log({
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      action: OperationalAction.PHOTO_UPLOADED,
    }).catch(() => {});
    return { photoUrl };
  }

  async removePhoto(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { photoUrl: null } });
    this.eventLogger.log({
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      action: OperationalAction.PHOTO_REMOVED,
    }).catch(() => {});
    return { success: true };
  }

  async resetPassword(id: string, newPassword: string) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id }, data: { password: hashedPassword } });
    return { message: 'Password reset successfully' };
  }

  async remove(id: string, actorId?: string) {
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    this.eventLogger.log({
      actorId: actorId ?? id,
      entityType: 'User',
      entityId: id,
      action: OperationalAction.USER_DEACTIVATED,
    }).catch(() => {});
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

    this.eventLogger.log({
      actorId: requesterId,
      entityType: 'EmployeeDocument',
      entityId: doc.id,
      action: OperationalAction.DOCUMENT_UPLOADED,
      metadata: { targetUserId, documentType, fileName: file.originalname },
    }).catch(() => {});

    // Sync the user's avatar/photo when (and only when) the uploaded document is
    // their Profile Photo. photoUrl is the canonical avatar field — the shared
    // UserAvatar, team page, profile page and navbar all render it — so writing
    // it here makes the admin-uploaded photo appear everywhere. All other
    // document types (Aadhaar, PAN, …) never touch the avatar.
    if (isProfilePhotoType(documentType)) {
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { photoUrl: fileUrl },
      });
      this.eventLogger.log({
        actorId: requesterId,
        entityType: 'User',
        entityId: targetUserId,
        action: OperationalAction.PHOTO_UPLOADED,
      }).catch(() => {});
    }

    return { document: doc };
  }

  async deleteDocument(requesterId: string, targetUserId: string, docId: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId }, include: { role: true } });
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, include: { role: true, department: true } });
    if (!target) throw new NotFoundException('User not found');
    if (!requester) throw new ForbiddenException('Not authorized');

    this.accessPolicy.assertAllowed(
      this.accessPolicy.canUploadDocuments(requester, target), // Assuming same permission as upload
      'Cannot delete documents for this user',
    );

    const doc = await (this.prisma as any).employeeDocument.findFirst({ where: { id: docId, userId: targetUserId } });
    if (!doc) throw new NotFoundException('Document not found');

    await (this.prisma as any).employeeDocument.delete({ where: { id: docId } });

    this.eventLogger.log({
      actorId: requesterId,
      entityType: 'EmployeeDocument',
      entityId: doc.id,
      action: OperationalAction.DOCUMENT_DELETED,
      metadata: { targetUserId, documentType: doc.documentType, fileName: doc.fileName },
    }).catch(() => {});

    return { success: true };
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

  async generateBackup(userId: string, actorId: string): Promise<{ buffer: Buffer; filename: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, department: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const [
      createdTickets,
      assignedTickets,
      comments,
      workSessions,
      breakLogs,
      leaveRequests,
      notifications,
      activityLogs,
      operationalEvents,
      managedDepts,
      projectMembers,
      employeeDocuments,
    ] = await Promise.all([
      this.prisma.ticket.findMany({ where: { createdById: userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
      this.prisma.ticket.findMany({ where: { assignedToId: userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
      this.prisma.comment.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
      this.prisma.workSession.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 365 }),
      this.prisma.breakLog.findMany({ where: { userId }, orderBy: { startAt: 'desc' }, take: 500 }),
      this.prisma.leaveRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.activityLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      (this.prisma as any).operationalEvent.findMany({ where: { actorId: userId }, orderBy: { timestamp: 'desc' }, take: 200 }),
      (this.prisma as any).managerDeptAccess.findMany({ where: { managerId: userId }, include: { department: { select: { name: true } } } }),
      this.prisma.projectMember.findMany({ where: { userId }, include: { project: { select: { projectId: true, name: true, status: true } } } }),
      (this.prisma as any).employeeDocument.findMany({ where: { userId }, orderBy: { uploadedAt: 'desc' } }),
    ]);

    const fmt = (v: any): string => {
      if (v == null) return '';
      if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
      return String(v);
    };

    // Appends a grey italic placeholder when a data sheet has zero records
    const noRecords = (ws: any) => {
      const r = ws.addRow(['No records found']);
      r.getCell(1).font = { italic: true };
    };

    const wb = new Workbook();
    wb.creator = 'Apex OS';
    wb.created = new Date();

    // ── Sheet 1: Backup Overview ─────────────────────────────────────────────
    const wsSummary = wb.addWorksheet('Backup Overview');
    wsSummary.getColumn(1).width = 36;
    wsSummary.getColumn(2).width = 56;

    // Section: User Information
    const uiHdr = wsSummary.addRow(['USER INFORMATION', '']);
    uiHdr.font = { bold: true };

    [
      ['Name', user.name],
      ['Email', user.email],
      ['Role', (user.role as any)?.name ?? ''],
      ['Department', (user.department as any)?.name ?? 'Unassigned'],
      ['Status', user.isActive ? 'Active' : 'Inactive (Deactivated)'],
      ['Employee ID', user.employeeId ?? '—'],
      ['Backup Generated At', fmt(new Date())],
    ].forEach(([label, value]) => wsSummary.addRow([label, value]));

    wsSummary.addRow([]);

    const noteRow = wsSummary.addRow([
      'Note',
      'This backup was generated before user deactivation/permanent deletion. Historical records are preserved for audit and compliance.',
    ]);
    noteRow.getCell(1).font = { bold: true };
    noteRow.getCell(2).font = { italic: true };

    wsSummary.addRow([]);

    // Section: Record Counts
    const rcHdr = wsSummary.addRow(['RECORD COUNTS', '']);
    rcHdr.font = { bold: true };

    const countColsHdr = wsSummary.addRow(['Sheet', 'Record Count']);
    countColsHdr.font = { bold: true };

    [
      ['Tickets Created', createdTickets.length],
      ['Tickets Assigned', assignedTickets.length],
      ['Comments', comments.length],
      ['Work Sessions', workSessions.length],
      ['Break Logs', breakLogs.length],
      ['Leave Requests', leaveRequests.length],
      ['Notifications', notifications.length],
      ['Activity Logs', activityLogs.length],
      ['Operational Events', operationalEvents.length],
      ['Manager Dept Access', managedDepts.length],
      ['Project Memberships', projectMembers.length],
      ['Documents Metadata', employeeDocuments.length],
    ].forEach(([sheet, count]) => wsSummary.addRow([sheet, count]));

    // ── Sheet 2: User Profile ────────────────────────────────────────────────
    const wsProfile = wb.addWorksheet('User Profile');
    wsProfile.columns = [
      { header: 'Field', key: 'f', width: 35 },
      { header: 'Value', key: 'v', width: 60 },
    ];
    wsProfile.getRow(1).font = { bold: true };
    wsProfile.views = [{ state: 'frozen', ySplit: 1 }];
    ([
      ['ID', user.id], ['Name', user.name], ['Email', user.email],
      ['Phone', user.phone], ['Date of Birth', fmt(user.dateOfBirth)],
      ['Gender', user.gender], ['Blood Group', user.bloodGroup],
      ['Current Address', user.currentAddress], ['Permanent Address', user.permanentAddress],
      ['Emergency Name', user.emergencyName], ['Emergency Phone', user.emergencyPhone],
      ['Emergency Relation', user.emergencyRelation], ['Employee ID', user.employeeId],
      ['Designation', user.designation], ['Employment Type', user.employmentType],
      ['Work Mode', user.workMode], ['Shift Timing', user.shiftTiming],
      ['Work Location', user.workLocation], ['User Location', user.userLocation],
      ['Reporting Manager', user.reportingManager], ['Team Lead', user.teamLeadName],
      ['Joining Date', fmt(user.joiningDate)], ['Probation Period', user.probationPeriod],
      ['CTC Annual', user.ctcAnnual], ['Basic Salary', user.basicSalary],
      ['Salary Structure', user.salaryStructure], ['Bank Name', user.bankName],
      ['Account Number', user.accountNumber], ['IFSC Code', user.ifscCode],
      ['Account Holder', user.accountHolderName], ['Payment Mode', user.paymentMode],
      ['PAN Number', user.panNumber], ['Aadhaar Number', user.aadhaarNumber],
      ['UAN Number', user.uanNumber], ['PF Applicable', fmt(user.pfApplicable)],
      ['ESIC Applicable', fmt(user.esicApplicable)], ['Professional Tax', fmt(user.professionalTax)],
      ['Tax Regime', user.taxRegime], ['Bio', user.bio],
      ['HR Notes', user.hrNotes], ['Verified By', user.verifiedBy],
      ['Verification Date', fmt(user.verificationDate)],
      ['Created At', fmt(user.createdAt)], ['Updated At', fmt(user.updatedAt)],
    ] as [string, any][]).forEach(([f, v]) => wsProfile.addRow({ f, v: fmt(v) }));

    // Shared plain-object column definitions for both ticket sheets.
    // Using a separate const (not wsCreated.columns getter) avoids spreading
    // ExcelJS Column class instances whose header/key/width live on the prototype
    // and do not survive a plain-object spread — which caused Tickets Assigned to
    // render with blank headers when there were zero assigned tickets.
    const ticketCols = [
      { header: 'Ticket ID', key: 'ticketId', width: 15 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Category', key: 'category', width: 14 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Due Date', key: 'dueDate', width: 22 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ];
    const fmtTicket = (t: any) => ({
      ticketId: t.ticketId, title: t.title, status: t.status,
      priority: t.priority, category: t.category, type: t.type,
      dueDate: fmt(t.dueDate), createdAt: fmt(t.createdAt),
    });

    // ── Sheet 3: Tickets Created ─────────────────────────────────────────────
    const wsCreated = wb.addWorksheet('Tickets Created');
    wsCreated.columns = ticketCols;
    wsCreated.getRow(1).font = { bold: true };
    wsCreated.views = [{ state: 'frozen', ySplit: 1 }];
    if (createdTickets.length === 0) noRecords(wsCreated);
    else createdTickets.forEach((t: any) => wsCreated.addRow(fmtTicket(t)));

    // ── Sheet 4: Tickets Assigned ────────────────────────────────────────────
    const wsAssigned = wb.addWorksheet('Tickets Assigned');
    wsAssigned.columns = ticketCols.map((c) => ({ ...c }));
    wsAssigned.getRow(1).font = { bold: true };
    wsAssigned.views = [{ state: 'frozen', ySplit: 1 }];
    if (assignedTickets.length === 0) noRecords(wsAssigned);
    else assignedTickets.forEach((t: any) => wsAssigned.addRow(fmtTicket(t)));

    // ── Sheet 5: Comments ────────────────────────────────────────────────────
    const wsComments = wb.addWorksheet('Comments');
    wsComments.columns = [
      { header: 'Ticket ID', key: 'ticketId', width: 30 },
      { header: 'Comment', key: 'content', width: 60 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ];
    wsComments.getRow(1).font = { bold: true };
    wsComments.views = [{ state: 'frozen', ySplit: 1 }];
    if (comments.length === 0) noRecords(wsComments);
    else comments.forEach((c: any) => wsComments.addRow({
      ticketId: c.ticketId, content: c.content, createdAt: fmt(c.createdAt),
    }));

    // ── Sheet 6: Work Sessions ───────────────────────────────────────────────
    const wsWork = wb.addWorksheet('Work Sessions');
    wsWork.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Login At', key: 'loginAt', width: 22 },
      { header: 'Work Start', key: 'startWorkAt', width: 22 },
      { header: 'Logout At', key: 'logoutAt', width: 22 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Work (min)', key: 'totalWorkMinutes', width: 12 },
      { header: 'Break (min)', key: 'totalBreakMinutes', width: 12 },
      { header: 'Logged (min)', key: 'totalLoggedMinutes', width: 13 },
      { header: 'Auto Closed', key: 'autoClosed', width: 12 },
    ];
    wsWork.getRow(1).font = { bold: true };
    wsWork.views = [{ state: 'frozen', ySplit: 1 }];
    if (workSessions.length === 0) noRecords(wsWork);
    else workSessions.forEach((s: any) => wsWork.addRow({
      date: fmt(s.date), loginAt: fmt(s.loginAt), startWorkAt: fmt(s.startWorkAt),
      logoutAt: fmt(s.logoutAt), status: s.status,
      totalWorkMinutes: s.totalWorkMinutes, totalBreakMinutes: s.totalBreakMinutes,
      totalLoggedMinutes: s.totalLoggedMinutes, autoClosed: s.autoClosed ? 'Yes' : 'No',
    }));

    // ── Sheet 7: Break Logs ──────────────────────────────────────────────────
    const wsBreaks = wb.addWorksheet('Break Logs');
    wsBreaks.columns = [
      { header: 'Break Type', key: 'breakType', width: 20 },
      { header: 'Start At', key: 'startAt', width: 22 },
      { header: 'End At', key: 'endAt', width: 22 },
      { header: 'Duration (min)', key: 'durationMinutes', width: 15 },
      { header: 'Note', key: 'note', width: 40 },
    ];
    wsBreaks.getRow(1).font = { bold: true };
    wsBreaks.views = [{ state: 'frozen', ySplit: 1 }];
    if (breakLogs.length === 0) noRecords(wsBreaks);
    else breakLogs.forEach((b: any) => wsBreaks.addRow({
      breakType: b.breakType, startAt: fmt(b.startAt), endAt: fmt(b.endAt),
      durationMinutes: b.durationMinutes ?? '', note: b.note ?? '',
    }));

    // ── Sheet 8: Leave Requests ──────────────────────────────────────────────
    const wsLeave = wb.addWorksheet('Leave Requests');
    wsLeave.columns = [
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Start Date', key: 'startDate', width: 14 },
      { header: 'End Date', key: 'endDate', width: 14 },
      { header: 'Reason', key: 'reason', width: 40 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Approved By', key: 'approvedBy', width: 25 },
      { header: 'Approved At', key: 'approvedAt', width: 22 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ];
    wsLeave.getRow(1).font = { bold: true };
    wsLeave.views = [{ state: 'frozen', ySplit: 1 }];
    if (leaveRequests.length === 0) noRecords(wsLeave);
    else leaveRequests.forEach((l: any) => wsLeave.addRow({
      type: l.type, startDate: fmt(l.startDate), endDate: fmt(l.endDate),
      reason: l.reason, status: l.status, approvedBy: l.approvedBy ?? '',
      approvedAt: fmt(l.approvedAt), createdAt: fmt(l.createdAt),
    }));

    // ── Sheet 9: Notifications ───────────────────────────────────────────────
    const wsNotif = wb.addWorksheet('Notifications');
    wsNotif.columns = [
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Message', key: 'message', width: 50 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Read', key: 'isRead', width: 8 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ];
    wsNotif.getRow(1).font = { bold: true };
    wsNotif.views = [{ state: 'frozen', ySplit: 1 }];
    if (notifications.length === 0) noRecords(wsNotif);
    else notifications.forEach((n: any) => wsNotif.addRow({
      title: n.title, message: n.message, type: n.type,
      isRead: n.isRead ? 'Yes' : 'No', createdAt: fmt(n.createdAt),
    }));

    // ── Sheet 10: Activity Logs ──────────────────────────────────────────────
    const wsActivity = wb.addWorksheet('Activity Logs');
    wsActivity.columns = [
      { header: 'Action', key: 'action', width: 30 },
      { header: 'Entity Type', key: 'entityType', width: 18 },
      { header: 'Entity ID', key: 'entityId', width: 30 },
      { header: 'Details', key: 'details', width: 50 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ];
    wsActivity.getRow(1).font = { bold: true };
    wsActivity.views = [{ state: 'frozen', ySplit: 1 }];
    if (activityLogs.length === 0) noRecords(wsActivity);
    else activityLogs.forEach((a: any) => wsActivity.addRow({
      action: a.action, entityType: a.entityType, entityId: a.entityId ?? '',
      details: a.details ? JSON.stringify(a.details) : '', createdAt: fmt(a.createdAt),
    }));

    // ── Sheet 11: Operational Events ─────────────────────────────────────────
    const wsOps = wb.addWorksheet('Operational Events');
    wsOps.columns = [
      { header: 'Action', key: 'action', width: 30 },
      { header: 'Entity Type', key: 'entityType', width: 18 },
      { header: 'Entity ID', key: 'entityId', width: 30 },
      { header: 'From State', key: 'fromState', width: 18 },
      { header: 'To State', key: 'toState', width: 18 },
      { header: 'Metadata', key: 'metadata', width: 50 },
      { header: 'Timestamp', key: 'timestamp', width: 22 },
    ];
    wsOps.getRow(1).font = { bold: true };
    wsOps.views = [{ state: 'frozen', ySplit: 1 }];
    if (operationalEvents.length === 0) noRecords(wsOps);
    else operationalEvents.forEach((e: any) => wsOps.addRow({
      action: e.action, entityType: e.entityType, entityId: e.entityId,
      fromState: e.fromState ?? '', toState: e.toState ?? '',
      metadata: e.metadata ? JSON.stringify(e.metadata) : '', timestamp: fmt(e.timestamp),
    }));

    // ── Sheet 12: Manager Dept Access ────────────────────────────────────────
    const wsMgr = wb.addWorksheet('Manager Dept Access');
    wsMgr.columns = [
      { header: 'Department', key: 'dept', width: 30 },
      { header: 'Access Level', key: 'accessLevel', width: 15 },
      { header: 'Since', key: 'createdAt', width: 22 },
    ];
    wsMgr.getRow(1).font = { bold: true };
    wsMgr.views = [{ state: 'frozen', ySplit: 1 }];
    if (managedDepts.length === 0) noRecords(wsMgr);
    else managedDepts.forEach((m: any) => wsMgr.addRow({
      dept: m.department?.name ?? m.departmentId,
      accessLevel: m.accessLevel, createdAt: fmt(m.createdAt),
    }));

    // ── Sheet 13: Project Memberships ────────────────────────────────────────
    const wsProj = wb.addWorksheet('Project Memberships');
    wsProj.columns = [
      { header: 'Project ID', key: 'projectId', width: 20 },
      { header: 'Project Name', key: 'name', width: 35 },
      { header: 'Project Status', key: 'status', width: 15 },
      { header: 'Member Role', key: 'role', width: 15 },
      { header: 'Joined At', key: 'joinedAt', width: 22 },
    ];
    wsProj.getRow(1).font = { bold: true };
    wsProj.views = [{ state: 'frozen', ySplit: 1 }];
    if (projectMembers.length === 0) noRecords(wsProj);
    else projectMembers.forEach((pm: any) => wsProj.addRow({
      projectId: pm.project?.projectId ?? '', name: pm.project?.name ?? '',
      status: pm.project?.status ?? '', role: pm.role, joinedAt: fmt(pm.joinedAt),
    }));

    // ── Sheet 14: Documents Metadata ─────────────────────────────────────────
    const wsDocs = wb.addWorksheet('Documents Metadata');
    wsDocs.columns = [
      { header: 'Document Type', key: 'documentType', width: 25 },
      { header: 'File Name', key: 'fileName', width: 35 },
      { header: 'Size (bytes)', key: 'fileSize', width: 13 },
      { header: 'MIME Type', key: 'mimeType', width: 25 },
      { header: 'Verification', key: 'verificationStatus', width: 18 },
      { header: 'Uploaded At', key: 'uploadedAt', width: 22 },
    ];
    wsDocs.getRow(1).font = { bold: true };
    wsDocs.views = [{ state: 'frozen', ySplit: 1 }];
    if (employeeDocuments.length === 0) noRecords(wsDocs);
    else employeeDocuments.forEach((d: any) => wsDocs.addRow({
      documentType: d.documentType, fileName: d.fileName,
      fileSize: d.fileSize ?? '', mimeType: d.mimeType ?? '',
      verificationStatus: d.verificationStatus, uploadedAt: fmt(d.uploadedAt),
    }));

    // Log export to audit trail
    this.eventLogger.log({
      actorId,
      entityType: 'User',
      entityId: userId,
      action: OperationalAction.EXPORT_PERFORMED,
      metadata: { exportType: 'user_backup_xlsx', targetUser: user.name, sheets: 14 },
    }).catch(() => {});

    // writeBuffer loads the full workbook into memory before sending.
    // Acceptable at current ~50-user scale. For larger deployments, refactor
    // to accept res: Response and stream via wb.xlsx.write(res) instead.
    const raw = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(raw);
    const safeName = user.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const date = new Date().toISOString().split('T')[0];

    return { buffer, filename: `backup-${safeName}-${date}.xlsx` };
  }
}
