import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventsGateway } from '../gateway/events.gateway';
import { NotificationType } from '@prisma/client';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger('SchedulerService');

  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
  ) {}

  /** Runs every 5 minutes — finds tickets scheduled within the last 5 minutes and notifies assignees */
  @Cron('*/5 * * * *', { name: 'scheduled-ticket-reminders' })
  async checkScheduledTickets() {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    try {
      const tickets = await this.prisma.ticket.findMany({
        where: {
          scheduledFor: { lte: now, gt: fiveMinAgo },
          status: 'OPEN',
        },
        include: {
          assignedTo: { select: { id: true, name: true } },
          assignees: { include: { user: { select: { id: true, name: true } } } },
        },
      });

      if (tickets.length === 0) return;

      this.logger.log(`[scheduler] Found ${tickets.length} scheduled ticket(s) to remind`);

      for (const ticket of tickets) {
        // Collect all assignee user IDs (primary + multiple)
        const recipientIds = new Set<string>();
        if (ticket.assignedTo?.id) recipientIds.add(ticket.assignedTo.id);
        for (const a of ticket.assignees ?? []) {
          if (a.user?.id) recipientIds.add(a.user.id);
        }

        for (const uid of recipientIds) {
          try {
            await this.prisma.notification.create({
              data: {
                userId: uid,
                title: 'Scheduled ticket reminder',
                message: `Ticket ${ticket.ticketId}: ${ticket.title} is scheduled for now`,
                type: NotificationType.INFO,
                isRead: false,
                link: `/tickets/${ticket.id}`,
                entityId: ticket.id,
                entityType: 'TICKET',
              },
            });
            this.gateway.emitNotificationToUser(uid, {
              title: 'Scheduled ticket reminder',
              message: `${ticket.ticketId}: ${ticket.title}`,
            });
          } catch (err) {
            this.logger.error(`[scheduler] Failed to notify user ${uid}: ${err}`);
          }
        }
      }

      this.logger.log(`[scheduler] Scheduled reminders sent for ${tickets.length} ticket(s)`);
    } catch (err) {
      this.logger.error(`[scheduler] checkScheduledTickets error: ${err}`);
    }
  }
}
