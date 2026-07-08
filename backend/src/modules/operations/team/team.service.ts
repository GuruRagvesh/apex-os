import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async sendTeamRequest(requesterId: string, targetUserId: string, reason?: string) {
    // Resolve requester and target names
    const [requester, target] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: requesterId },
        include: { department: true },
      }),
      this.prisma.user.findUnique({
        where: { id: targetUserId },
        include: { department: true },
      }),
    ]);

    if (!target) throw new NotFoundException('Target user not found');

    // Find the manager: preferred manager from config first (deterministic —
    // unlike the OR+findFirst pattern this replaced, which never actually
    // guaranteed priority), fallback to any MANAGER.
    const preferredManagerEmail = this.config.get<string>('TEAM_REQUEST_PREFERRED_MANAGER_EMAIL');
    let manager = preferredManagerEmail
      ? await this.prisma.user.findFirst({
          where: { email: preferredManagerEmail },
          select: { id: true, name: true },
        })
      : null;

    if (!manager) {
      manager = await this.prisma.user.findFirst({
        where: { role: { name: { in: ['MANAGER'] } } },
        select: { id: true, name: true },
      });
    }

    if (!manager) throw new NotFoundException('No manager found to send request to');

    const reasonText = reason?.trim()
      ? ` Reason: ${reason.trim()}`
      : '';

    const requesterDept = (requester as any)?.department?.name ?? 'their team';
    await this.notifications.create(
      manager.id,
      'Team Addition Request',
      `${requester?.name ?? 'Someone'} has requested ${target.name} (${target.department?.name ?? 'No dept'}) to be added to ${requesterDept}.${reasonText}`,
      'INFO',
      '/team',
    );

    return {
      status: 'pending',
      message: `Request sent to ${manager.name}`,
    };
  }
}
