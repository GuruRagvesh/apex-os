import { Injectable, Inject, forwardRef, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { NotificationEventService } from '../../operations/notifications/notification-event.service';
import { NotificationType } from '@prisma/client';
import { TVAService } from '../../../common/services/tva.service';
import * as bcrypt from 'bcryptjs';
import { Cron, CronExpression } from '@nestjs/schedule';

const PERSONAL_INFORMATION_REQUEST = 'PERSONAL_INFORMATION';
const PERSONAL_INFORMATION_FIELDS = new Set([
  'legalName', 'dateOfBirth', 'gender', 'bloodGroup', 'phone', 'personalEmail',
  'currentAddress', 'permanentAddress', 'emergencyName', 'emergencyRelation', 'emergencyPhone',
]);
const PERSONAL_INFORMATION_PENDING = ['AWAITING_EMPLOYEE_CONFIRMATION', 'PENDING_HR_REVIEW'];
const PERSONAL_INFORMATION_DOCUMENT_FIELDS = new Set(['legalName', 'dateOfBirth']);
/**
 * The only fields an approved hierarchy change request may write (Phase 4,
 * correction 12). Department and role move through the Transfer workflow;
 * HR authority, activation, employment state, lifecycle dates, identifiers and
 * credentials are never written by a change request.
 */
export const HIERARCHY_REQUEST_FIELDS: ReadonlySet<string> = new Set(['designation', 'teamLeadName', 'reportingManager']);

export function disallowedChangeFields(changes: unknown): string[] {
  const list = Array.isArray(changes) ? changes : [];
  const bad = list
    .map((c: any) => (c && typeof c.field === 'string' ? c.field : '(missing)'))
    .filter((f: string) => !HIERARCHY_REQUEST_FIELDS.has(f));
  return [...new Set(bad)];
}

function assertAllowedChangeFields(changes: unknown): void {
  const bad = disallowedChangeFields(changes);
  if (bad.length > 0) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'CHANGE_REQUEST_FIELD_NOT_ALLOWED',
      message: 'This request asks to change a field that cannot be changed by request. Department and role changes are made by an Admin with Transfer. Nothing was applied.',
      fields: bad,
    });
  }
}

@Injectable()
export class ChangeRequestsService {
  constructor(
    private prisma: PrismaService,
    private accessPolicy: AccessPolicyService,
    private eventLogger: EventLoggerService,
    @Inject(forwardRef(() => NotificationEventService))
    private notificationService: NotificationEventService,
    private tva: TVAService,
  ) {}

  private roleName(user: any): string {
    return (user?.role as any)?.name ?? user?.role ?? '';
  }

  private isAuthorizedHr(user: any): boolean {
    return Boolean(user?.isHR) || ['ADMIN', 'SUPER_ADMIN'].includes(this.roleName(user));
  }

  private normalizePersonalValue(field: string, value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') throw new BadRequestException(`${field} must be text`);
    const trimmed = value.trim();
    if (trimmed.length > 500) throw new BadRequestException(`${field} is too long`);
    if (['legalName', 'emergencyName', 'emergencyRelation'].includes(field) && trimmed.length > 200) {
      throw new BadRequestException(`${field} must be at most 200 characters`);
    }
    if (field === 'gender' && !['Female', 'Male', 'Non-binary', 'Prefer not to say'].includes(trimmed)) {
      throw new BadRequestException('Gender selection is invalid');
    }
    if (field === 'bloodGroup' && !['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(trimmed)) {
      throw new BadRequestException('Blood group is invalid');
    }
    if (field === 'dateOfBirth') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(new Date(`${trimmed}T00:00:00.000Z`).getTime())) {
        throw new BadRequestException('Date of birth must be a valid date');
      }
    }
    if (field === 'personalEmail' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new BadRequestException('Personal email is invalid');
    }
    if (['phone', 'emergencyPhone'].includes(field) && !/^\+?[0-9 ()-]{7,20}$/.test(trimmed)) {
      throw new BadRequestException(`${field} is invalid`);
    }
    return trimmed || null;
  }

  private comparablePersonalValue(field: string, value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (field === 'dateOfBirth') return new Date(value as any).toISOString().slice(0, 10);
    return String(value);
  }

  async createPersonalInformationRequest(
    targetUserId: string,
    dto: { changes: Array<{ field: string; newValue: unknown }>; reason: string; supportingDocumentIds?: string[] },
    requesterToken: any,
  ) {
    const requesterId = requesterToken?.id ?? requesterToken?.sub;
    const [requester, target] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: requesterId }, include: { role: true } }),
      this.prisma.user.findUnique({ where: { id: targetUserId }, include: { role: true } }),
    ]);
    if (!requester || !target) throw new NotFoundException('Employee not found');
    const employeeInitiated = requesterId === targetUserId;
    if (!employeeInitiated && !this.isAuthorizedHr(requester)) {
      throw new ForbiddenException('Only authorized HR can initiate a correction for another employee');
    }
    if (!employeeInitiated && !target.isActive) {
      throw new BadRequestException('Post-exit employee confirmation is not configured yet');
    }
    const reason = typeof dto?.reason === 'string' ? dto.reason.trim() : '';
    if (!reason || reason.length > 1000) throw new BadRequestException('A reason is required');
    if (!Array.isArray(dto?.changes) || dto.changes.length === 0) {
      throw new BadRequestException('Select at least one personal detail to change');
    }
    const seen = new Set<string>();
    const changes = dto.changes.map((change) => {
      if (!change || !PERSONAL_INFORMATION_FIELDS.has(change.field) || seen.has(change.field)) {
        throw new BadRequestException('A requested field is invalid or duplicated');
      }
      seen.add(change.field);
      const oldValue = this.comparablePersonalValue(change.field, (target as any)[change.field]);
      const newValue = this.normalizePersonalValue(change.field, change.newValue);
      if (oldValue === newValue) throw new BadRequestException(`${change.field} has not changed`);
      return { field: change.field, oldValue, newValue };
    });
    const supportingDocumentIds = Array.isArray(dto.supportingDocumentIds)
      ? [...new Set(dto.supportingDocumentIds.filter((id) => typeof id === 'string' && id))]
      : [];
    if (changes.some((change) => PERSONAL_INFORMATION_DOCUMENT_FIELDS.has(change.field)) && supportingDocumentIds.length === 0) {
      throw new BadRequestException('Legal-name and date-of-birth corrections require a supporting document');
    }
    if (supportingDocumentIds.length > 0) {
      const documents = await this.prisma.employeeDocument.findMany({
        where: { id: { in: supportingDocumentIds }, userId: targetUserId },
        select: { id: true },
      });
      if (documents.length !== supportingDocumentIds.length) throw new ForbiddenException('A supporting document is unavailable');
    }
    const pending = await this.prisma.employeeProfileChangeRequest.findFirst({
      where: { targetUserId, requestType: PERSONAL_INFORMATION_REQUEST, status: { in: PERSONAL_INFORMATION_PENDING } },
      select: { id: true },
    });
    if (pending) throw new ConflictException('An unresolved personal information request already exists');

    let request: any;
    try {
      request = await this.prisma.employeeProfileChangeRequest.create({
        data: {
          targetUserId,
          requestedById: requesterId,
          requestType: PERSONAL_INFORMATION_REQUEST,
          status: employeeInitiated ? 'PENDING_HR_REVIEW' : 'AWAITING_EMPLOYEE_CONFIRMATION',
          changes,
          reason,
          supportingDocumentIds,
        },
        include: { targetUser: { select: { name: true, employeeId: true } }, requestedBy: { select: { name: true } } },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('An unresolved personal information request already exists');
      throw error;
    }
    this.eventLogger.log({
      actorId: requesterId,
      entityType: 'EmployeeProfileChangeRequest',
      entityId: request.id,
      action: OperationalAction.PERSONAL_INFORMATION_CHANGE_REQUESTED,
      metadata: { targetUserId, fields: changes.map((change) => change.field), employeeInitiated },
    }).catch(() => {});
    if (employeeInitiated) await this.notifyHrReviewers(request, 'Personal information request awaiting review');
    else await this.notificationService.sendNotification(targetUserId, 'profileChangeConfirmation', {
      title: 'Confirm a personal information correction',
      message: `${requester.name} proposed corrections to your official personal information.`,
      type: NotificationType.INFO,
      link: '/settings?tab=personal-info',
      entityId: request.id,
      entityType: 'EmployeeProfileChangeRequest',
    }).catch(() => {});
    return request;
  }

  async listMyPersonalInformationRequests(userId: string) {
    return this.prisma.employeeProfileChangeRequest.findMany({
      where: { targetUserId: userId, requestType: PERSONAL_INFORMATION_REQUEST },
      orderBy: { createdAt: 'desc' },
      include: { requestedBy: { select: { id: true, name: true } }, currentApprover: { select: { name: true } } },
    });
  }

  async confirmPersonalInformationRequest(requestId: string, userId: string, currentPassword: string) {
    const request = await this.prisma.employeeProfileChangeRequest.findUnique({ where: { id: requestId } });
    if (!request || request.requestType !== PERSONAL_INFORMATION_REQUEST) throw new NotFoundException('Request not found');
    if (request.targetUserId !== userId) throw new ForbiddenException('Only the employee can confirm this request');
    if (request.status !== 'AWAITING_EMPLOYEE_CONFIRMATION') throw new BadRequestException('Request is not awaiting confirmation');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
      throw new ForbiddenException('Fresh authentication failed');
    }
    const updated = await this.prisma.employeeProfileChangeRequest.update({
      where: { id: requestId },
      data: { status: 'PENDING_HR_REVIEW', employeeConfirmedAt: this.tva.now() },
    });
    this.eventLogger.log({ actorId: userId, entityType: 'EmployeeProfileChangeRequest', entityId: requestId,
      action: OperationalAction.PERSONAL_INFORMATION_CHANGE_CONFIRMED }).catch(() => {});
    await this.notifyHrReviewers(updated, 'Confirmed personal information request awaiting review');
    return updated;
  }

  async declinePersonalInformationRequest(requestId: string, userId: string, reasonValue: string) {
    const reason = typeof reasonValue === 'string' ? reasonValue.trim() : '';
    if (!reason) throw new BadRequestException('A decline reason is required');
    const request = await this.prisma.employeeProfileChangeRequest.findUnique({ where: { id: requestId } });
    if (!request || request.requestType !== PERSONAL_INFORMATION_REQUEST) throw new NotFoundException('Request not found');
    if (request.targetUserId !== userId) throw new ForbiddenException('Only the employee can decline this request');
    if (request.status !== 'AWAITING_EMPLOYEE_CONFIRMATION') throw new BadRequestException('Request is not awaiting confirmation');
    const updated = await this.prisma.employeeProfileChangeRequest.update({ where: { id: requestId }, data: {
      status: 'DECLINED_BY_EMPLOYEE', employeeDeclinedAt: this.tva.now(), employeeDeclineReason: reason,
    } });
    this.eventLogger.log({ actorId: userId, entityType: 'EmployeeProfileChangeRequest', entityId: requestId,
      action: OperationalAction.PERSONAL_INFORMATION_CHANGE_DECLINED, metadata: { reason } }).catch(() => {});
    await this.notificationService.sendNotification(request.requestedById, 'profileChangeResult', {
      title: 'Personal information correction declined', message: reason, type: NotificationType.INFO,
      link: '/admin/approvals', entityId: requestId, entityType: 'EmployeeProfileChangeRequest',
    }).catch(() => {});
    return updated;
  }

  private async notifyHrReviewers(request: any, title: string) {
    const reviewers = await this.prisma.user.findMany({
      where: { isActive: true, OR: [{ isHR: true }, { role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } }] },
      select: { id: true },
    });
    await Promise.all(reviewers.filter((reviewer) => reviewer.id !== request.requestedById).map((reviewer) =>
      this.notificationService.sendNotification(reviewer.id, 'profileChangeReview', {
        title,
        message: 'Review the requested official personal-information correction.',
        type: NotificationType.INFO,
        link: '/admin/approvals',
        entityId: request.id,
        entityType: 'EmployeeProfileChangeRequest',
        dedupeKey: `personal-information-review:${request.id}:${reviewer.id}`,
      }).catch(() => {}),
    ));
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sendEmployeeConfirmationReminders() {
    const now = this.tva.now();
    const waiting = await this.prisma.employeeProfileChangeRequest.findMany({
      where: { requestType: PERSONAL_INFORMATION_REQUEST, status: 'AWAITING_EMPLOYEE_CONFIRMATION' },
      select: { id: true, targetUserId: true, createdAt: true },
    });
    await Promise.all(waiting.map(async (request) => {
      const elapsedHours = (now.getTime() - request.createdAt.getTime()) / 3_600_000;
      if (elapsedHours < 48) return;
      const reminderNumber = Math.floor((elapsedHours - 48) / 72);
      await this.notificationService.sendNotification(request.targetUserId, 'profileChangeConfirmation', {
        title: 'Personal information correction needs your confirmation',
        message: 'Review the HR-proposed correction in Personal Details.',
        type: NotificationType.INFO,
        link: '/settings?tab=personal-info',
        entityId: request.id,
        entityType: 'EmployeeProfileChangeRequest',
        dedupeKey: `personal-information-confirmation:${request.id}:${reminderNumber}`,
      }).catch(() => {});
    }));
  }

  async getHierarchySummary(targetUserId: string, requester: any) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { role: true, department: true },
    });
    if (!target) throw new NotFoundException('User not found');
    const roleName = (requester?.role as any)?.name ?? '';

    // Check permissions
    if (requester.id !== targetUserId && !['ADMIN', 'SUPER_ADMIN'].includes(roleName) && !requester.isHR) {
      if (['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
        const managedDeptIds = await this.accessPolicy.managedDepartmentIds(requester);
        if (!target.departmentId || !managedDeptIds.includes(target.departmentId)) {
          throw new ForbiddenException('You do not have permission to view this user hierarchy');
        }
      } else {
        throw new ForbiddenException('You do not have permission to view this user hierarchy');
      }
    }

    const reportingManager = target.reportingManager ? await this.prisma.user.findUnique({ where: { employeeId: target.reportingManager } }) : null;
    const teamLead = target.teamLeadName ? await this.prisma.user.findUnique({ where: { employeeId: target.teamLeadName } }) : null;

    const peopleReportingToMe = await this.prisma.user.findMany({
      where: {
        OR: [
          { reportingManager: target.employeeId ?? undefined },
          { teamLeadName: target.employeeId ?? undefined },
        ],
        isActive: true,
      },
      select: { id: true, name: true, designation: true },
    });

    const isTeamLead = roleName === 'TEAM_LEAD';
    const isManager = roleName === 'MANAGER';
    const isDepartmentOwner = isManager && !!target.departmentId; // Simplification

    return {
      role: (target.role as any)?.name,
      designation: target.designation,
      reportsTo: teamLead ? { id: teamLead.id, name: teamLead.name } : reportingManager ? { id: reportingManager.id, name: reportingManager.name } : null,
      primaryManager: reportingManager ? { id: reportingManager.id, name: reportingManager.name } : null,
      peopleReportingToMe,
      departmentsTiedTo: target.department ? [{ id: target.department.id, name: target.department.name, type: 'PRIMARY' }] : [],
      leadershipResponsibility: {
        isTeamLead,
        isManager,
        isDepartmentOwner,
      },
      hierarchyPath: [], // Derived if needed
    };
  }

  async createChangeRequest(targetUserId: string, dto: { requestType: string; changes: any[]; reason?: string }, requester: any) {
    assertAllowedChangeFields(dto?.changes);
    if (targetUserId !== requester.id) {
      // In this pack, employees request for themselves. TLs can request for employees.
      const requesterRole = this.accessPolicy.roleName(requester);
      if (!['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(requesterRole)) {
        throw new ForbiddenException('You cannot request changes for another user');
      }
    }

    const existingPending = await (this.prisma as any).employeeProfileChangeRequest.findFirst({
      where: {
        targetUserId,
        status: { in: ['PENDING_TL_APPROVAL', 'PENDING_MANAGER_APPROVAL', 'PENDING_ADMIN_APPROVAL'] },
      },
    });

    // Check if duplicate sensitive field is requested
    if (existingPending) {
      const existingChanges = existingPending.changes as any[];
      for (const ch of dto.changes) {
        if (existingChanges.some((ec) => ec.field === ch.field)) {
          throw new ConflictException(`A pending request already exists for field: ${ch.field}`);
        }
      }
    }

    const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId }, include: { role: true } });
    if (!targetUser) throw new NotFoundException('Target user not found');

    const targetRoleName = (targetUser.role as any)?.name ?? '';
    const requesterRoleName = this.accessPolicy.roleName(requester);
    
    let nextStatus = 'PENDING_MANAGER_APPROVAL';
    let currentApproverId = null;

    if (['EMPLOYEE', 'INTERN'].includes(requesterRoleName) || ['EMPLOYEE', 'INTERN'].includes(targetRoleName)) {
      if (targetUser.teamLeadName) {
        nextStatus = 'PENDING_TL_APPROVAL';
        const tl = await this.prisma.user.findUnique({ where: { employeeId: targetUser.teamLeadName } });
        if (tl) currentApproverId = tl.id;
      } else if (targetUser.reportingManager) {
        nextStatus = 'PENDING_MANAGER_APPROVAL';
        const mgr = await this.prisma.user.findUnique({ where: { employeeId: targetUser.reportingManager } });
        if (mgr) currentApproverId = mgr.id;
        else nextStatus = 'PENDING_ADMIN_APPROVAL';
      } else {
        nextStatus = 'PENDING_ADMIN_APPROVAL';
      }
    } else if (requesterRoleName === 'TEAM_LEAD' || targetRoleName === 'TEAM_LEAD') {
      nextStatus = 'PENDING_MANAGER_APPROVAL';
      if (targetUser.reportingManager) {
        const mgr = await this.prisma.user.findUnique({ where: { employeeId: targetUser.reportingManager } });
        if (mgr) currentApproverId = mgr.id;
        else nextStatus = 'PENDING_ADMIN_APPROVAL';
      } else {
        nextStatus = 'PENDING_ADMIN_APPROVAL';
      }
    } else if (['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(requesterRoleName) || ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(targetRoleName)) {
      nextStatus = 'PENDING_ADMIN_APPROVAL';
    }

    // Capture old values
    const changesWithOld = dto.changes.map((ch) => ({
      ...ch,
      oldValue: (targetUser as any)[ch.field] ?? null,
    }));

    const req = await (this.prisma as any).employeeProfileChangeRequest.create({
      data: {
        targetUserId,
        requestedById: requester.id,
        requestType: dto.requestType,
        status: nextStatus,
        changes: changesWithOld,
        reason: dto.reason,
        currentApproverId,
      },
    });

    this.eventLogger.log({
      actorId: requester.id,
      entityType: 'EmployeeProfileChangeRequest',
      entityId: req.id,
      action: 'CHANGE_REQUEST_CREATED',
      metadata: { targetUserId, requestType: dto.requestType },
    }).catch(() => {});

    if (currentApproverId) {
      const summary = changesWithOld.map(ch => `${ch.field} from ${ch.oldValue || 'None'} to ${ch.newValue}`).join(', ');
      await this.notificationService.sendNotification(currentApproverId, 'system', {
        title: 'Pending Hierarchy Approval',
        message: `${requester.name} requested changes to ${dto.requestType} for ${targetUser.name}. Changes: ${summary}`,
        type: NotificationType.INFO,
        link: `/dashboard?action=approve_hierarchy&id=${req.id}`,
      }).catch(() => {});
    }

    return req;
  }

  async listMyChangeRequests(requesterId: string) {
    return (this.prisma as any).employeeProfileChangeRequest.findMany({
      where: {
        OR: [
          { targetUserId: requesterId },
          { requestedById: requesterId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        targetUser: { select: { name: true, employeeId: true } },
        requestedBy: { select: { name: true } },
        currentApprover: { select: { name: true } },
      },
    });
  }

  async listPendingApprovals(requesterId: string, roleName: string, isHR = false) {
    // JWTs created before the isHR claim was added may not carry the functional
    // authority flag. Hydrate it from the database so HR employees are neither
    // over- nor under-authorized by stale token metadata.
    const actor = await this.prisma.user.findUnique({ where: { id: requesterId }, include: { role: true } });
    const effectiveRoleName = this.roleName(actor) || roleName;
    const hasHrAuthority = Boolean(actor?.isHR) || isHR;
    const conditions: any = [];

    // Directly assigned approver
    conditions.push({ currentApproverId: requesterId });

    if (['ADMIN', 'SUPER_ADMIN'].includes(effectiveRoleName)) {
      conditions.push({ status: 'PENDING_ADMIN_APPROVAL' });
    }

    if (hasHrAuthority || ['ADMIN', 'SUPER_ADMIN'].includes(effectiveRoleName)) {
      conditions.push({ status: 'PENDING_HR_REVIEW', requestType: PERSONAL_INFORMATION_REQUEST, requestedById: { not: requesterId } });
    }

    return (this.prisma as any).employeeProfileChangeRequest.findMany({
      where: {
        OR: conditions,
        status: { in: ['PENDING_TL_APPROVAL', 'PENDING_MANAGER_APPROVAL', 'PENDING_ADMIN_APPROVAL', 'PENDING_HR_REVIEW'] },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        targetUser: { select: { name: true, employeeId: true } },
        requestedBy: { select: { name: true } },
      },
    });
  }

  async approveChangeRequest(requestId: string, requester: any, note?: string) {
    const req = await (this.prisma as any).employeeProfileChangeRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Request not found');

    if (req.requestType === PERSONAL_INFORMATION_REQUEST) {
      return this.approvePersonalInformationRequest(req, requester, note);
    }

    // A request raised before the allow-list existed is refused here, before
    // its status moves, so nothing is applied and it can be rejected instead.
    assertAllowedChangeFields(req.changes);

    const roleName = this.accessPolicy.roleName(requester);
    
    if (req.currentApproverId && req.currentApproverId !== requester.id && !['ADMIN', 'SUPER_ADMIN'].includes(roleName)) {
      throw new ForbiddenException('Not authorized to approve this request');
    }

    let nextStatus = req.status;
    const updateData: any = {};
    let currentApproverId = null;

    if (req.status === 'PENDING_TL_APPROVAL') {
      updateData.tlApproverId = requester.id;
      updateData.tlDecision = 'APPROVED';
      nextStatus = 'PENDING_MANAGER_APPROVAL';
      
      const targetUser = await this.prisma.user.findUnique({ where: { id: req.targetUserId } });
      if (targetUser?.reportingManager) {
        const mgr = await this.prisma.user.findUnique({ where: { employeeId: targetUser.reportingManager } });
        if (mgr) currentApproverId = mgr.id;
        else nextStatus = 'PENDING_ADMIN_APPROVAL';
      } else {
        nextStatus = 'PENDING_ADMIN_APPROVAL';
      }
    } else if (req.status === 'PENDING_MANAGER_APPROVAL') {
      updateData.managerApproverId = requester.id;
      updateData.managerDecision = 'APPROVED';
      nextStatus = 'APPROVED';
      updateData.approvedAt = this.tva.now();
    } else if (req.status === 'PENDING_ADMIN_APPROVAL') {
      if (!['ADMIN', 'SUPER_ADMIN'].includes(roleName)) throw new ForbiddenException('Admin approval required');
      updateData.adminApproverId = requester.id;
      updateData.adminDecision = 'APPROVED';
      nextStatus = 'APPROVED';
      updateData.approvedAt = this.tva.now();
    } else {
      throw new BadRequestException(`Cannot approve request in status ${req.status}`);
    }

    updateData.status = nextStatus;
    updateData.currentApproverId = currentApproverId;

    const updated = await (this.prisma as any).employeeProfileChangeRequest.update({
      where: { id: requestId },
      data: updateData,
    });

    if (nextStatus === 'APPROVED') {
      await this.applyApprovedChanges(updated);
      await this.notificationService.sendNotification(req.requestedById, 'system', {
        title: 'Hierarchy Request Approved',
        message: `Your hierarchy change request for ${req.targetUser?.name || 'the employee'} has been approved.`,
        type: NotificationType.INFO,
      }).catch(() => {});
    } else if (currentApproverId) {
      const summary = (req.changes as any[]).map(ch => `${ch.field} to ${ch.newValue}`).join(', ');
      await this.notificationService.sendNotification(currentApproverId, 'system', {
        title: 'Pending Hierarchy Approval (Escalated)',
        message: `A hierarchy change request for ${req.targetUser?.name || 'an employee'} requires your approval. Changes: ${summary}`,
        type: NotificationType.INFO,
        link: `/dashboard?action=approve_hierarchy&id=${req.id}`,
      }).catch(() => {});
    }

    this.eventLogger.log({
      actorId: requester.id,
      entityType: 'EmployeeProfileChangeRequest',
      entityId: requestId,
      action: 'CHANGE_REQUEST_APPROVED',
      metadata: { newStatus: nextStatus, note },
    }).catch(() => {});

    return updated;
  }

  async rejectChangeRequest(requestId: string, requester: any, reason: string) {
    const req = await (this.prisma as any).employeeProfileChangeRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Request not found');

    if (req.requestType === PERSONAL_INFORMATION_REQUEST) {
      return this.rejectPersonalInformationRequest(req, requester, reason);
    }

    const roleName = this.accessPolicy.roleName(requester);
    if (req.currentApproverId && req.currentApproverId !== requester.id && !['ADMIN', 'SUPER_ADMIN'].includes(roleName)) {
      throw new ForbiddenException('Not authorized to reject this request');
    }

    const updateData: any = {
      status: 'REJECTED',
      rejectionReason: reason,
      rejectedAt: this.tva.now(),
      currentApproverId: null,
    };

    if (req.status === 'PENDING_TL_APPROVAL') {
      updateData.tlApproverId = requester.id;
      updateData.tlDecision = 'REJECTED';
    } else if (req.status === 'PENDING_MANAGER_APPROVAL') {
      updateData.managerApproverId = requester.id;
      updateData.managerDecision = 'REJECTED';
    } else if (req.status === 'PENDING_ADMIN_APPROVAL') {
      updateData.adminApproverId = requester.id;
      updateData.adminDecision = 'REJECTED';
    }

    const updated = await (this.prisma as any).employeeProfileChangeRequest.update({
      where: { id: requestId },
      data: updateData,
    });

    this.eventLogger.log({
      actorId: requester.id,
      entityType: 'EmployeeProfileChangeRequest',
      entityId: requestId,
      action: 'CHANGE_REQUEST_REJECTED',
      metadata: { reason },
    }).catch(() => {});

    await this.notificationService.sendNotification(req.requestedById, 'system', {
      title: 'Hierarchy Request Rejected',
      message: `Your hierarchy change request for ${req.targetUser?.name || 'the employee'} was rejected. ${reason ? 'Reason: ' + reason : ''}`,
      type: NotificationType.INFO,
    }).catch(() => {});

    return updated;
  }

  async cancelChangeRequest(requestId: string, requesterId: string) {
    const req = await (this.prisma as any).employeeProfileChangeRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Request not found');

    if (req.requestType === PERSONAL_INFORMATION_REQUEST) {
      throw new BadRequestException('Submitted personal information requests cannot be withdrawn');
    }

    if (req.requestedById !== requesterId) {
      throw new ForbiddenException('Only the requester can cancel the request');
    }

    if (!['PENDING_TL_APPROVAL', 'PENDING_MANAGER_APPROVAL', 'PENDING_ADMIN_APPROVAL'].includes(req.status)) {
      throw new BadRequestException('Request is no longer pending');
    }

    const updated = await (this.prisma as any).employeeProfileChangeRequest.update({
      where: { id: requestId },
      data: {
        status: 'CANCELLED',
        cancelledAt: this.tva.now(),
        currentApproverId: null,
      },
    });

    return updated;
  }

  private async applyApprovedChanges(request: any) {
    assertAllowedChangeFields(request.changes);
    const changes = request.changes as any[];
    const updateData: any = {};
    for (const ch of changes) {
      updateData[ch.field] = ch.newValue;
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.user.update({
        where: { id: request.targetUserId },
        data: updateData,
      });
    }
  }

  private async approvePersonalInformationRequest(request: any, requesterToken: any, note?: string) {
    const reviewerId = requesterToken?.id ?? requesterToken?.sub;
    const reviewer = await this.prisma.user.findUnique({ where: { id: reviewerId }, include: { role: true } });
    if (!reviewer || !this.isAuthorizedHr(reviewer)) throw new ForbiddenException('Authorized HR review is required');
    if (request.status !== 'PENDING_HR_REVIEW') throw new BadRequestException(`Cannot approve request in status ${request.status}`);
    if (request.requestedById === reviewerId) throw new ForbiddenException('The initiator cannot approve their own request');
    const approvedAt = this.tva.now();
    const result = await this.prisma.$transaction(async (tx) => {
      const currentRequest = await tx.employeeProfileChangeRequest.findUnique({ where: { id: request.id } });
      if (!currentRequest || currentRequest.status !== 'PENDING_HR_REVIEW') {
        throw new ConflictException('This request has already been processed');
      }
      const target = await tx.user.findUnique({ where: { id: request.targetUserId } });
      if (!target) throw new NotFoundException('Employee not found');
      const updateData: Record<string, any> = {};
      for (const change of currentRequest.changes as any[]) {
        if (!PERSONAL_INFORMATION_FIELDS.has(change.field)) throw new BadRequestException('Request contains an unsupported field');
        const currentValue = this.comparablePersonalValue(change.field, (target as any)[change.field]);
        if (currentValue !== (change.oldValue ?? null)) {
          throw new ConflictException(`Official ${change.field} changed after submission; reject this outdated request`);
        }
        updateData[change.field] = change.field === 'dateOfBirth' && change.newValue
          ? new Date(`${change.newValue}T00:00:00.000Z`)
          : change.newValue;
      }
      await tx.user.update({ where: { id: request.targetUserId }, data: updateData });
      return tx.employeeProfileChangeRequest.update({ where: { id: request.id }, data: {
        status: 'APPROVED', adminApproverId: reviewerId, adminDecision: 'APPROVED', approvedAt,
        currentApproverId: null,
      } });
    });
    this.eventLogger.log({ actorId: reviewerId, entityType: 'EmployeeProfileChangeRequest', entityId: request.id,
      action: OperationalAction.PERSONAL_INFORMATION_CHANGE_APPROVED, metadata: { note } }).catch(() => {});
    await this.notificationService.sendNotification(request.targetUserId, 'profileChangeResult', {
      title: 'Personal information request approved', message: 'Your approved official details are now updated.',
      type: NotificationType.INFO, link: '/settings?tab=personal-info', entityId: request.id,
      entityType: 'EmployeeProfileChangeRequest',
    }).catch(() => {});
    return result;
  }

  private async rejectPersonalInformationRequest(request: any, requesterToken: any, reasonValue: string) {
    const reviewerId = requesterToken?.id ?? requesterToken?.sub;
    const reason = typeof reasonValue === 'string' ? reasonValue.trim() : '';
    if (!reason) throw new BadRequestException('A rejection reason is required');
    const reviewer = await this.prisma.user.findUnique({ where: { id: reviewerId }, include: { role: true } });
    if (!reviewer || !this.isAuthorizedHr(reviewer)) throw new ForbiddenException('Authorized HR review is required');
    if (!PERSONAL_INFORMATION_PENDING.includes(request.status)) throw new BadRequestException(`Cannot reject request in status ${request.status}`);
    if (request.status === 'PENDING_HR_REVIEW' && request.requestedById === reviewerId) {
      throw new ForbiddenException('The initiator cannot review their own request');
    }
    const updated = await this.prisma.employeeProfileChangeRequest.update({ where: { id: request.id }, data: {
      status: 'REJECTED', rejectionReason: reason, rejectedAt: this.tva.now(),
      adminApproverId: reviewerId, adminDecision: 'REJECTED', currentApproverId: null,
    } });
    this.eventLogger.log({ actorId: reviewerId, entityType: 'EmployeeProfileChangeRequest', entityId: request.id,
      action: OperationalAction.PERSONAL_INFORMATION_CHANGE_REJECTED, metadata: { reason } }).catch(() => {});
    await this.notificationService.sendNotification(request.targetUserId, 'profileChangeResult', {
      title: 'Personal information request rejected', message: reason, type: NotificationType.INFO,
      link: '/settings?tab=personal-info', entityId: request.id, entityType: 'EmployeeProfileChangeRequest',
    }).catch(() => {});
    return updated;
  }
}
