import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveStatus, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { EmailService } from '../../platform/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
    private configService: ConfigService,
  ) {}

  private get frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  async findAll(query: { userId?: string; status?: LeaveStatus; departmentId?: string }) {
    const where: any = {};
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.departmentId) where.user = { departmentId: query.departmentId };

    return this.prisma.leaveRequest.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true, department: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const leave = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true, department: true } } },
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    return leave;
  }

  async create(data: any, userId: string) {
    const { startDate, endDate, ...rest } = data;
    return this.prisma.leaveRequest.create({
      data: {
        ...rest,
        userId,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
      },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async approve(id: string, approverId: string) {
    const leave = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!leave) throw new NotFoundException();
    if (leave.status !== LeaveStatus.PENDING) throw new ForbiddenException('Already processed');

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.APPROVED, approvedBy: approverId, approvedAt: new Date() },
    });

    // Real-time + notification + email
    this.gateway.emitLeaveStatusChanged(id, 'APPROVED', leave.userId);

    const startStr = leave.startDate.toISOString().split('T')[0];
    const endStr = leave.endDate.toISOString().split('T')[0];

    await Promise.all([
      this.notificationsService.create(
        leave.userId,
        'Leave request approved',
        `Your ${leave.type} leave (${startStr} â€“ ${endStr}) has been approved.`,
        NotificationType.SUCCESS,
        '/leave',
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

  async reject(id: string, rejectorId: string) {
    const leave = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!leave) throw new NotFoundException();
    if (leave.status !== LeaveStatus.PENDING) throw new ForbiddenException('Already processed');

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.REJECTED, rejectedBy: rejectorId, rejectedAt: new Date() },
    });

    this.gateway.emitLeaveStatusChanged(id, 'REJECTED', leave.userId);

    const startStr = leave.startDate.toISOString().split('T')[0];
    const endStr = leave.endDate.toISOString().split('T')[0];

    await Promise.all([
      this.notificationsService.create(
        leave.userId,
        'Leave request rejected',
        `Your ${leave.type} leave (${startStr} â€“ ${endStr}) has been rejected.`,
        NotificationType.WARNING,
        '/leave',
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
    const leave = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException();
    if (leave.userId !== userId) throw new ForbiddenException();

    return this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.CANCELLED },
    });
  }

  async getStats() {
    const [total, pending, approved, rejected] = await Promise.all([
      this.prisma.leaveRequest.count(),
      this.prisma.leaveRequest.count({ where: { status: LeaveStatus.PENDING } }),
      this.prisma.leaveRequest.count({ where: { status: LeaveStatus.APPROVED } }),
      this.prisma.leaveRequest.count({ where: { status: LeaveStatus.REJECTED } }),
    ]);
    return { total, pending, approved, rejected };
  }
}
