import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { NotificationEventService } from '../../operations/notifications/notification-event.service';
import { NotificationType } from '@prisma/client';

@Injectable()
export class ChangeRequestsService {
  constructor(
    private prisma: PrismaService,
    private accessPolicy: AccessPolicyService,
    private eventLogger: EventLoggerService,
    private notificationService: NotificationEventService,
  ) {}

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

  async listPendingApprovals(requesterId: string, roleName: string) {
    const conditions: any = [];

    // Directly assigned approver
    conditions.push({ currentApproverId: requesterId });

    if (['ADMIN', 'SUPER_ADMIN'].includes(roleName)) {
      conditions.push({ status: 'PENDING_ADMIN_APPROVAL' });
    }

    return (this.prisma as any).employeeProfileChangeRequest.findMany({
      where: {
        OR: conditions,
        status: { in: ['PENDING_TL_APPROVAL', 'PENDING_MANAGER_APPROVAL', 'PENDING_ADMIN_APPROVAL'] },
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
      updateData.approvedAt = new Date();
    } else if (req.status === 'PENDING_ADMIN_APPROVAL') {
      if (!['ADMIN', 'SUPER_ADMIN'].includes(roleName)) throw new ForbiddenException('Admin approval required');
      updateData.adminApproverId = requester.id;
      updateData.adminDecision = 'APPROVED';
      nextStatus = 'APPROVED';
      updateData.approvedAt = new Date();
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

    const roleName = this.accessPolicy.roleName(requester);
    if (req.currentApproverId && req.currentApproverId !== requester.id && !['ADMIN', 'SUPER_ADMIN'].includes(roleName)) {
      throw new ForbiddenException('Not authorized to reject this request');
    }

    const updateData: any = {
      status: 'REJECTED',
      rejectionReason: reason,
      rejectedAt: new Date(),
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
        cancelledAt: new Date(),
        currentApproverId: null,
      },
    });

    return updated;
  }

  private async applyApprovedChanges(request: any) {
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
}
