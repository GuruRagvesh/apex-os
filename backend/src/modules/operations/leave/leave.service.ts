import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveStatus, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { EmailService } from '../../platform/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
    private configService: ConfigService,
    private eventLogger: EventLoggerService,
    private leaveAccess: LeaveAccessService,
  ) {}

  private get frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  private async buildLeaveScope(user: any): Promise<any> {
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    if (['EMPLOYEE', 'INTERN'].includes(roleName)) {
      return { userId: user.id };
    }
    if (roleName === 'TEAM_LEAD') {
      if (!user.departmentId) return { userId: user.id };
      return { user: { departmentId: user.departmentId } };
    }
    if (roleName === 'MANAGER') {
      const access = await this.prisma.managerDeptAccess.findMany({ where: { managerId: user.id } });
      const deptIds: string[] = access.map((a: any) => a.departmentId as string);
      if (user.departmentId && !deptIds.includes(user.departmentId)) deptIds.push(user.departmentId);
      const unique = [...new Set(deptIds)];
      if (unique.length === 0) return { userId: user.id };
      return { user: { departmentId: { in: unique } } };
    }
    if ((user as any).isHR) return {};
    // ADMIN / SUPER_ADMIN
    return {};
  }

  async findAll(query: { userId?: string; status?: LeaveStatus; departmentId?: string; page?: number; limit?: number }, user?: any) {
    const where = await this.leaveAccess.buildLeaveWhereForUser(query, user);

    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const skip  = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.leaveRequest.count({ where }),
      this.prisma.leaveRequest.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true, department: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: any) {
    const include = { user: { select: { id: true, name: true, email: true, department: true, role: true } } };
    const leave = user
      ? await this.leaveAccess.findAccessibleLeave(id, user, include)
      : await this.prisma.leaveRequest.findUnique({
      where: { id },
      include,
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    return leave;
  }

  async create(data: any, userId: string) {
    const { startDate, endDate, ...rest } = data;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ForbiddenException('Invalid leave dates');
    }
    if (start.getTime() > end.getTime()) {
      throw new ForbiddenException('Leave start date cannot be after end date');
    }
    const leave = await this.prisma.leaveRequest.create({
      data: {
        ...rest,
        userId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
      include: { user: { select: { id: true, name: true } } },
    });
    this.eventLogger.log({ actorId: userId, entityType: 'LeaveRequest', entityId: leave.id, action: OperationalAction.LEAVE_REQUESTED, toState: 'PENDING', metadata: { type: leave.type } }).catch(() => {});
    return leave;
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
      data: { status: LeaveStatus.APPROVED, approvedBy: approverId, approvedAt: new Date() },
    });

    this.eventLogger.log({ actorId: approverId, entityType: 'LeaveRequest', entityId: id, action: OperationalAction.LEAVE_APPROVED, fromState: 'PENDING', toState: 'APPROVED' }).catch(() => {});

    // Real-time + notification + email
    this.gateway.emitLeaveStatusChanged(id, 'APPROVED', leave.userId);

    const startStr = leave.startDate.toISOString().split('T')[0];
    const endStr = leave.endDate.toISOString().split('T')[0];

    await Promise.all([
      this.notificationsService.create(
        leave.userId,
        'Leave request approved',
        `Your ${leave.type} leave (${startStr} to ${endStr}) has been approved.`,
        NotificationType.SUCCESS,
        '/leave',
        leave.id,
        'LEAVE',
      ),
      this.emailService.sendLeaveDecision(
        leave.user.email,
        'APPROVED',
        leave.type,
        startStr,
        endStr,
        this.frontendUrl,
      ),
    ]);

    this.gateway.emitNotificationToUser(leave.userId, {
      title: 'Leave request approved',
      message: `Your ${leave.type} leave has been approved.`,
    });

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
      data: { status: LeaveStatus.REJECTED, rejectedBy: rejectorId, rejectedAt: new Date() },
    });

    this.eventLogger.log({ actorId: rejectorId, entityType: 'LeaveRequest', entityId: id, action: OperationalAction.LEAVE_REJECTED, fromState: 'PENDING', toState: 'REJECTED' }).catch(() => {});

    this.gateway.emitLeaveStatusChanged(id, 'REJECTED', leave.userId);

    const startStr = leave.startDate.toISOString().split('T')[0];
    const endStr = leave.endDate.toISOString().split('T')[0];

    await Promise.all([
      this.notificationsService.create(
        leave.userId,
        'Leave request rejected',
        `Your ${leave.type} leave (${startStr} to ${endStr}) has been rejected.`,
        NotificationType.WARNING,
        '/leave',
        leave.id,
        'LEAVE',
      ),
      this.emailService.sendLeaveDecision(
        leave.user.email,
        'REJECTED',
        leave.type,
        startStr,
        endStr,
        this.frontendUrl,
      ),
    ]);

    this.gateway.emitNotificationToUser(leave.userId, {
      title: 'Leave request rejected',
      message: `Your ${leave.type} leave has been rejected.`,
    });

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
      action: OperationalAction.LEAVE_REJECTED, // closest available action; captures the cancel event
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
          await this.notificationsService.create(
            mgr.id,
            `Leave cancelled: ${leave.user.name}`,
            `${leave.type} leave request (${startStr} to ${endStr}) has been cancelled by the employee.`,
            NotificationType.INFO,
            '/leave',
            leave.id,
            'LEAVE',
          );
          this.gateway.emitNotificationToUser(mgr.id, {
            title: `Leave cancelled: ${leave.user.name}`,
            message: `${leave.type} leave (${startStr} to ${endStr}) was withdrawn.`,
          });
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
