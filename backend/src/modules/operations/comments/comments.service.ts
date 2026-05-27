import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { NotificationEventService } from '../notifications/notification-event.service';
import { NotificationType } from '@prisma/client';

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private ticketAccess: TicketAccessService,
    private notificationEventService: NotificationEventService,
  ) {}

  async findByTicket(ticketId: string, user: any) {
    await this.ticketAccess.assertCanViewTicket(user, ticketId);
    return this.prisma.comment.findMany({
      where: { ticketId },
      include: { author: { select: { id: true, name: true, avatar: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(ticketId: string, content: string, authorId: string, user: any) {
    await this.ticketAccess.assertCanCreateComment(user, ticketId);
    const comment = await this.prisma.comment.create({
      data: { ticketId, content, authorId },
      include: { author: { select: { id: true, name: true, avatar: true, role: true } } },
    });

    await this.prisma.activityLog.create({
      data: { userId: authorId, action: 'COMMENTED', entityType: 'TICKET', entityId: ticketId },
    });

    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
          assignees: { select: { userId: true } },
        },
      });

      if (ticket) {
        const recipients = new Set<string>();
        if (ticket.createdById && ticket.createdById !== authorId) {
          recipients.add(ticket.createdById);
        }
        if (ticket.assignedToId && ticket.assignedToId !== authorId) {
          recipients.add(ticket.assignedToId);
        }
        if (ticket.assignees) {
          for (const a of ticket.assignees) {
            if (a.userId && a.userId !== authorId) {
              recipients.add(a.userId);
            }
          }
        }

        const authorName = comment.author?.name || 'Someone';
        for (const recipientId of recipients) {
          await this.notificationEventService.sendNotification(recipientId, 'commentAdded', {
            title: `New comment on ${ticket.ticketId}`,
            message: `${authorName} commented: "${content.length > 60 ? content.substring(0, 60) + '...' : content}"`,
            type: NotificationType.INFO,
            link: `/tickets/${ticket.id}`,
            entityId: ticket.id,
            entityType: 'TICKET',
          });
        }
      }
    } catch (err) {
      console.error('Failed to send comment notification:', err);
    }

    return comment;
  }

  async update(id: string, content: string, userId: string, user?: any) {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (user) await this.ticketAccess.assertCanViewTicket(user, comment.ticketId);
    if (comment.authorId !== userId) throw new ForbiddenException('Cannot edit others comments');

    return this.prisma.comment.update({
      where: { id },
      data: { content },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    });
  }

  async remove(id: string, userId: string, userRole: string, user?: any) {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (user) await this.ticketAccess.assertCanViewTicket(user, comment.ticketId);
    if (comment.authorId !== userId && !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) throw new ForbiddenException();
    return this.prisma.comment.delete({ where: { id } });
  }
}
