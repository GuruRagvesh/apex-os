import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveStatus, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { EmailService } from '../../platform/email/email.service';
import { NotificationEventService } from '../notifications/notification-event.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';
import { LeaveBalanceService } from './leave-balance.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { TVAService } from '../../../common/services/tva.service';

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    private emailService: EmailService,
    private notificationEventService: NotificationEventService,
    private configService: ConfigService,
    private eventLogger: EventLoggerService,
    private leaveAccess: LeaveAccessService,
    private leaveBalance: LeaveBalanceService,
    private accessPolicy: AccessPolicyService,
    private tva: TVAService,
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
      const duration = await this.leaveBalance.getDurationForRequest(item.startDate, item.endDate, item.isHalfDay);
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
    const duration = await this.leaveBalance.getDurationForRequest(leave.startDate, leave.endDate, leave.isHalfDay);
    return { ...leave, duration };
  }

  async getDurationForRequest(startDate: string, endDate: string, isHalfDay: boolean) {
    return this.leaveBalance.getDurationForRequest(startDate, endDate, isHalfDay);
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

  async approve(id: string, approverId: string, user?: any) {
    const include = { user: { select: { id: true, name: true, email: true, role: true, departmentId: true } } };
    const leave = user
      ? await this.leaveAccess.findAccessibleLeave(id, user, include)
      : await this.prisma.leaveRequest.findUnique({ where: { id }, include });
    if (!leave) throw new NotFoundException();
    const actor = user ?? await this.prisma.user.findUnique({ where: { id: approverId }, include: { role: true, department: true } });
    if (!actor) throw new ForbiddenException('Not authorized');
    await this.leaveAccess.assertCanApproveReject(actor, leave, 'approve');

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

    try {
      await this.emailService.sendLeaveDecision(
        leave.user.email,
        'APPROVED',
        leave.type,
        startStr,
        endStr,
        this.frontendUrl,
      );
    } catch (_e) { /* never crash main op */ }

    return updated;
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

    try {
      await this.emailService.sendLeaveDecision(
        leave.user.email,
        'REJECTED',
        leave.type,
        startStr,
        endStr,
        this.frontendUrl,
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
