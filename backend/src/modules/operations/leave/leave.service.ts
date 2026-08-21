import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveStatus, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { NotificationEventService } from '../notifications/notification-event.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';
import { LeaveBalanceService } from './leave-balance.service';
import { LeaveSettlementService } from './leave-settlement.service';
import {
  ATTENDANCE_V2_DEFAULTS,
  ATTENDANCE_V2_SETTING_KEY,
} from '../../platform/attendance/punch/punch-evidence.types';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { TVAService } from '../../../common/services/tva.service';
import { SettingsService } from '../../platform/settings/settings.service';
import { HierarchyApprovalService } from '../../../common/services/hierarchy-approval.service';

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    private notificationEventService: NotificationEventService,
    private configService: ConfigService,
    private eventLogger: EventLoggerService,
    private leaveAccess: LeaveAccessService,
    private leaveBalance: LeaveBalanceService,
    private leaveSettlement: LeaveSettlementService,
    private accessPolicy: AccessPolicyService,
    private tva: TVAService,
    private settings: SettingsService,
    private hierarchy: HierarchyApprovalService,
  ) {}

  private get frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  async findAll(query: { userId?: string; status?: LeaveStatus; departmentId?: string; page?: number; limit?: number }, user?: any) {
    const where = await this.leaveAccess.buildLeaveWhereForUser(query, user);

    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const skip  = (page - 1) * limit;

    const [total, dbItems] = await Promise.all([
      this.prisma.leaveRequest.count({ where }),
      this.prisma.leaveRequest.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true, department: true, role: true, reportingManager: true, teamLeadName: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const items = await Promise.all(dbItems.map(async (item) => {
      const duration = await this.leaveBalance.getDurationForRequest(item.startDate, item.endDate, item.isHalfDay, item.userId);
      return { ...item, duration };
    }));

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: any) {
    const include = { user: { select: { id: true, name: true, email: true, department: true, role: true, reportingManager: true, teamLeadName: true } } };
    const leave = user
      ? await this.leaveAccess.findAccessibleLeave(id, user, include)
      : await this.prisma.leaveRequest.findUnique({
      where: { id },
      include,
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    const duration = await this.leaveBalance.getDurationForRequest(leave.startDate, leave.endDate, leave.isHalfDay, leave.userId);
    return { ...leave, duration };
  }

  // userId is optional so the existing public surface is unchanged, but
  // passing it is what lets the employee's own calendar decide the duration.
  async getDurationForRequest(startDate: string, endDate: string, isHalfDay: boolean, userId?: string) {
    return this.leaveBalance.getDurationForRequest(startDate, endDate, isHalfDay, userId);
  }

  async create(data: any, userId: string) {
    const { startDate, endDate, isHalfDay, halfDayType, ...rest } = data;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ForbiddenException('Invalid leave dates');
    }
    if (start.getTime() > end.getTime()) {
      throw new ForbiddenException('Leave start date cannot be after end date');
    }

    // Validate balance and check overlaps
    await this.leaveBalance.validateLeaveRequest(userId, start, end, !!isHalfDay);

    const leave = await this.prisma.leaveRequest.create({
      data: {
        ...rest,
        userId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        isHalfDay: !!isHalfDay,
        halfDayType: halfDayType || null,
      },
      include: { user: { select: { id: true, name: true, departmentId: true } } },
    });
    this.eventLogger.log({ actorId: userId, entityType: 'LeaveRequest', entityId: leave.id, action: OperationalAction.LEAVE_REQUESTED, toState: 'PENDING', metadata: { type: leave.type } }).catch(() => {});

    // Notify managers
    try {
      if (leave.user.departmentId) {
        const managers = await this.prisma.user.findMany({
          where: {
            isActive: true,
            role: { name: { in: ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'TEAM_LEAD'] } },
            OR: [
              { departmentId: leave.user.departmentId },
              { managedDepts: { some: { departmentId: leave.user.departmentId } } },
            ],
          },
          select: { id: true },
        });
        const startStr = start.toISOString().split('T')[0];
        const endStr   = end.toISOString().split('T')[0];
        for (const mgr of managers) {
          if (mgr.id === userId) continue; // don't notify self
          await this.notificationEventService.sendNotification(
            mgr.id,
            'teamLeaveApply',
            {
              title: `New leave request: ${leave.user.name}`,
              message: `${leave.user.name} requested ${leave.type} leave (${startStr} to ${endStr}).`,
              type: NotificationType.INFO,
              link: '/leave',
              entityId: leave.id,
              entityType: 'LEAVE',
            }
          );
        }
      }
    } catch (_e) { /* non-critical */ }

    return leave;
  }

  async getUserBalance(userId: string, requester: any) {
    if (requester.id !== userId) {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true, department: true },
      });
      if (!targetUser) throw new NotFoundException('User not found');
      const canView = await this.accessPolicy.canViewUser(requester, targetUser);
      if (!canView) throw new ForbiddenException('You do not have permission to view this user\'s leave balance');
    }
    return this.leaveBalance.getLeaveBalance(userId);
  }

  /** Whether the two-stage Manager -> HR approval chain is switched on. */
  private async approvalLifecycleEnabled(): Promise<boolean> {
    const cfg = await this.settings.get(ATTENDANCE_V2_SETTING_KEY);
    return (
      (cfg?.leaveApprovalEnabled ?? ATTENDANCE_V2_DEFAULTS.leaveApprovalEnabled) === true
    );
  }

  async approve(id: string, approverId: string, user?: any) {
    const include = { user: { select: { id: true, name: true, email: true, role: true, departmentId: true } } };
    const leave = user
      ? await this.leaveAccess.findAccessibleLeave(id, user, include)
      : await this.prisma.leaveRequest.findUnique({ where: { id }, include });
    if (!leave) throw new NotFoundException();
    const actor = user ?? await this.prisma.user.findUnique({ where: { id: approverId }, include: { role: true, department: true } });
    if (!actor) throw new ForbiddenException('Not authorized');
    await this.leaveAccess.assertCanApproveReject(actor, leave, 'approve');

    // ── Two-stage chain (LH-2) ────────────────────────────────────────────
    // With the flag off this whole block is skipped and the original
    // single-approval behaviour below runs exactly as it does today.
    if (await this.approvalLifecycleEnabled()) {
      return this.approveThroughLifecycle(leave, actor, approverId);
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.APPROVED, approvedBy: approverId, approvedAt: this.tva.now() },
    });

    this.eventLogger.log({ actorId: approverId, entityType: 'LeaveRequest', entityId: id, action: OperationalAction.LEAVE_APPROVED, fromState: 'PENDING', toState: 'APPROVED' }).catch(() => {});

    // Real-time + notification + email
    this.gateway.emitLeaveStatusChanged(id, 'APPROVED', leave.userId);

    const startStr = leave.startDate.toISOString().split('T')[0];
    const endStr = leave.endDate.toISOString().split('T')[0];

    try {
      await this.notificationEventService.sendNotification(
        leave.userId,
        'leaveApproved',
        {
          title: 'Leave request approved',
          message: `Your ${leave.type} leave (${startStr} to ${endStr}) has been approved.`,
          type: NotificationType.SUCCESS,
          link: '/leave',
          entityId: leave.id,
          entityType: 'LEAVE',
        }
      );
    } catch (_e) { /* never crash main op */ }

    return updated;
  }

  /**
   * Manager -> HR approval, on the existing LeaveRequest.
   *
   * The request stays PENDING for the whole chain; only HR's approval flips the
   * status. That is what keeps every existing reader of `status` correct while a
   * request is mid-review.
   */
  private async approveThroughLifecycle(leave: any, actor: any, approverId: string) {
    const isHr = this.accessPolicy.isHrOrAdmin(actor);

    if (leave.approvalStage === 'MANAGER_REVIEW') {
      // Stage one must be THIS employee's reporting authority, not merely
      // somebody who happens to hold a MANAGER or TEAM_LEAD role. The chain
      // comes from the existing Apex hierarchy (User.teamLeadName /
      // User.reportingManager -> employeeId), the same one ticket approval
      // uses -- leave must not answer "who reports to whom" differently.
      //
      // The employee is structurally excluded from their own chain, so this
      // also makes self-approval impossible at this stage.
      const chain = await this.hierarchy.resolveApproverChainFor(leave.userId);
      const entry = chain.find((c) => c.id === approverId);
      if (!entry) {
        throw new ForbiddenException(
          "Only this employee's reporting hierarchy can approve their leave request",
        );
      }

      // Admin/SuperAdmin escalation is an established Apex convention and is
      // preserved -- but recorded, so an override is visible in the audit trail
      // rather than indistinguishable from a manager acting normally.
      const viaAdminOverride = entry.tier === 'ADMIN';

      // HR approving at the manager stage would skip a review the company
      // requires, so the chain always advances one step at a time.
      const updated = await this.prisma.leaveRequest.update({
        where: { id: leave.id },
        data: {
          approvalStage: 'HR_REVIEW',
          managerApprovedById: approverId,
          managerApprovedAt: this.tva.now(),
        },
      });

      this.eventLogger.log({
        actorId: approverId,
        entityType: 'LeaveRequest',
        entityId: leave.id,
        action: OperationalAction.LEAVE_APPROVED,
        fromState: 'MANAGER_REVIEW',
        toState: viaAdminOverride ? 'HR_REVIEW (admin override)' : 'HR_REVIEW',
      }).catch(() => {});

      // The employee is told it moved, not that it was granted -- it has not
      // been, and saying so would be a promise the company has not made.
      try {
        await this.notificationEventService.sendNotification(leave.userId, 'leaveApproved', {
          title: 'Leave request sent to HR',
          message: 'Your reporting manager approved your leave. It is now with HR for final approval.',
          type: NotificationType.INFO,
          link: '/leave',
          entityId: leave.id,
          entityType: 'LEAVE',
        });
      } catch (_e) { /* never crash main op */ }

      return updated;
    }

    if (leave.approvalStage === 'HR_REVIEW') {
      if (!isHr) {
        throw new ForbiddenException('Only HR can give final approval for leave');
      }

      // Everything that decides the outcome happens inside this call, under a
      // lock: stage re-check, balance read, split, and the final write.
      const { leave: updated, settlement } = await this.leaveSettlement.settleAndApprove({
        leaveId: leave.id,
        hrApproverId: approverId,
      });

      this.eventLogger.log({
        actorId: approverId,
        entityType: 'LeaveRequest',
        entityId: leave.id,
        action: OperationalAction.LEAVE_APPROVED,
        fromState: 'HR_REVIEW',
        toState: 'APPROVED',
      }).catch(() => {});

      this.gateway.emitLeaveStatusChanged(leave.id, 'APPROVED', leave.userId);

      const startStr = new Date(leave.startDate).toISOString().split('T')[0];
      const endStr = new Date(leave.endDate).toISOString().split('T')[0];
      const funding =
        settlement.fundingOutcome === 'PAID'
          ? ''
          : settlement.fundingOutcome === 'UNPAID'
            ? ' It is recorded as leave without pay, as your paid balance is exhausted.'
            : ` ${settlement.paidDays} day(s) are paid and ${settlement.unpaidDays} day(s) are without pay.`;

      try {
        await this.notificationEventService.sendNotification(leave.userId, 'leaveApproved', {
          title: 'Leave request approved',
          message: `Your ${leave.type} leave (${startStr} to ${endStr}) has been approved.${funding}`,
          type: NotificationType.SUCCESS,
          link: '/leave',
          entityId: leave.id,
          entityType: 'LEAVE',
        });
      } catch (_e) { /* never crash main op */ }

      return updated;
    }

    throw new ForbiddenException('This leave request has already completed its approval chain');
  }

  async reject(id: string, rejectorId: string, user?: any) {
    const include = { user: { select: { id: true, name: true, email: true, role: true, departmentId: true } } };
    const leave = user
      ? await this.leaveAccess.findAccessibleLeave(id, user, include)
      : await this.prisma.leaveRequest.findUnique({ where: { id }, include });
    if (!leave) throw new NotFoundException();
    const actor = user ?? await this.prisma.user.findUnique({ where: { id: rejectorId }, include: { role: true, department: true } });
    if (!actor) throw new ForbiddenException('Not authorized');
    await this.leaveAccess.assertCanApproveReject(actor, leave, 'reject');

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.REJECTED, rejectedBy: rejectorId, rejectedAt: this.tva.now() },
    });

    this.eventLogger.log({ actorId: rejectorId, entityType: 'LeaveRequest', entityId: id, action: OperationalAction.LEAVE_REJECTED, fromState: 'PENDING', toState: 'REJECTED' }).catch(() => {});

    this.gateway.emitLeaveStatusChanged(id, 'REJECTED', leave.userId);

    const startStr = leave.startDate.toISOString().split('T')[0];
    const endStr = leave.endDate.toISOString().split('T')[0];

    try {
      await this.notificationEventService.sendNotification(
        leave.userId,
        'leaveRejected',
        {
          title: 'Leave request rejected',
          message: `Your ${leave.type} leave (${startStr} to ${endStr}) has been rejected.`,
          type: NotificationType.WARNING,
          link: '/leave',
          entityId: leave.id,
          entityType: 'LEAVE',
        }
      );
    } catch (_e) { /* never crash main op */ }

    return updated;
  }

  async cancel(id: string, userId: string) {
    const leave = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, departmentId: true } } },
    });
    if (!leave) throw new NotFoundException();
    if (leave.userId !== userId) throw new ForbiddenException();

    // Only PENDING leaves can be cancelled by the requester.
    // APPROVED leaves would require HR/manager to reverse — out of scope here.
    if (leave.status !== LeaveStatus.PENDING) {
      throw new ForbiddenException('Only pending leave requests can be cancelled');
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.CANCELLED },
    });

    this.eventLogger.log({
      actorId: userId,
      entityType: 'LeaveRequest',
      entityId: id,
      action: OperationalAction.LEAVE_CANCELLED,
      fromState: 'PENDING',
      toState: 'CANCELLED',
    }).catch(() => {});

    // Notify managers/admins in the requester's department so their pending queue stays accurate
    try {
      if (leave.user.departmentId) {
        const managers = await this.prisma.user.findMany({
          where: {
            isActive: true,
            role: { name: { in: ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'TEAM_LEAD'] } },
            OR: [
              { departmentId: leave.user.departmentId },
              { managedDepts: { some: { departmentId: leave.user.departmentId } } },
            ],
          },
          select: { id: true },
        });
        const startStr = leave.startDate.toISOString().split('T')[0];
        const endStr   = leave.endDate.toISOString().split('T')[0];
        for (const mgr of managers) {
          if (mgr.id === userId) continue; // don't notify self
          await this.notificationEventService.sendNotification(
            mgr.id,
            'teamLeaveApply',
            {
              title: `Leave cancelled: ${leave.user.name}`,
              message: `${leave.type} leave request (${startStr} to ${endStr}) has been cancelled by the employee.`,
              type: NotificationType.INFO,
              link: '/leave',
              entityId: leave.id,
              entityType: 'LEAVE',
            }
          );
        }
      }
    } catch (_e) { /* non-critical — never crash the cancel operation */ }

    return updated;
  }

  async getStats(user?: any) {
    const scope = await this.leaveAccess.buildLeaveWhereForUser({}, user);
    const [total, pending, approved, rejected] = await Promise.all([
      this.prisma.leaveRequest.count({ where: scope }),
      this.prisma.leaveRequest.count({ where: { ...scope, status: LeaveStatus.PENDING } }),
      this.prisma.leaveRequest.count({ where: { ...scope, status: LeaveStatus.APPROVED } }),
      this.prisma.leaveRequest.count({ where: { ...scope, status: LeaveStatus.REJECTED } }),
    ]);
    return { total, pending, approved, rejected };
  }
}
