import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sendTeamRequest(requesterId: string, targetUserId: string, reason?: string) {
    // Resolve requester and target names
    const [requester, target] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: requesterId },
        select: { name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: targetUserId },
        include: { department: true },
      }),
    ]);

    if (!target) throw new NotFoundException('Target user not found');

    // Find the manager (Tejas Kadam first, fallback to any MANAGER)
    const manager = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: 'tejas.kadam@technoedgels.com' },
          { role: { name: { in: ['MANAGER'] } } },
        ],
      },
      select: { id: true, name: true },
    });

    if (!manager) throw new NotFoundException('No manager found to send request to');

    const reasonText = reason?.trim()
      ? ` Reason: ${reason.trim()}`
      : '';

    await this.notifications.create(
      manager.id,
      'Team Addition Request',
      `${requester?.name ?? 'Someone'} has requested ${target.name} to be added to the AI & R&D team.${reasonText}`,
      'INFO',
      '/team',
    );

    return {
      status: 'pending',
      message: `Request sent to ${manager.name}`,
    };
  }
}
