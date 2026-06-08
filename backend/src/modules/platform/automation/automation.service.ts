import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { NotificationType } from '@prisma/client';
import { TVAService } from '../../../common/services/tva.service';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger('AutomationService');

  constructor(
    private prisma: PrismaService,
    private ticketTiming: TicketTimingService,
    private tva: TVAService,
  ) {}

  // ── Ticket assigned ─────────────────────────────────────────────────────────
  @OnEvent('ticket.assigned', { async: true })
  async onTicketAssigned({ ticket, assigneeId, assignedBy }: {
    ticket: any;
    assigneeId: string;
    assignedBy: string;
  }) {
    try {
      // In-app notification for the new assignee
      await this.prisma.notification.create({
        data: {
          userId:  assigneeId,
          title:   `New ticket assigned: ${ticket.ticketId}`,
          message: ticket.title,
          type:    NotificationType.INFO,
          isRead:  false,
          link:    `/tickets/${ticket.id}`,
        },
      });

      this.logger.log(`[automation] ticket.assigned → notified user ${assigneeId}`);
    } catch (err) {
      this.logger.error(`[automation] onTicketAssigned failed: ${err}`);
    }
  }

  // ── Status changed ───────────────────────────────────────────────────────────
  @OnEvent('ticket.status_changed', { async: true })
  async onStatusChanged({ ticket, oldStatus, newStatus, userId }: {
    ticket:    any;
    oldStatus: string;
    newStatus: string;
    userId:    string;
  }) {
    try {
      // Activity log
      await this.prisma.activityLog.create({
        data: {
          userId,
          action:     'STATUS_CHANGED',
          entityType: 'TICKET',
          entityId:   ticket.id,
          details:    { from: oldStatus, to: newStatus, ticketId: ticket.ticketId },
        },
      });

      // If resolved — notify reporter (if different from the resolver)
      if (newStatus === 'DONE' && ticket.createdById && ticket.createdById !== userId) {
        await this.prisma.notification.create({
          data: {
            userId:  ticket.createdById,
            title:   `Ticket resolved: ${ticket.ticketId}`,
            message: `${ticket.title} has been marked Done`,
            type:    NotificationType.SUCCESS,
            isRead:  false,
            link:    `/tickets/${ticket.id}`,
          },
        });
      }

      this.logger.log(
        `[automation] ticket.status_changed ${ticket.ticketId}: ${oldStatus} → ${newStatus}`,
      );
    } catch (err) {
      this.logger.error(`[automation] onStatusChanged failed: ${err}`);
    }
  }

  // ── Ticket created ───────────────────────────────────────────────────────────
  @OnEvent('ticket.created', { async: true })
  async onTicketCreated({ ticket, userId }: { ticket: any; userId: string }) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId,
          action:     'TICKET_CREATED',
          entityType: 'TICKET',
          entityId:   ticket.id,
          details:    {
            ticketId: ticket.ticketId,
            title:    ticket.title,
            priority: ticket.priority,
            dept:     ticket.department?.name,
          },
        },
      });

      this.logger.log(`[automation] ticket.created → logged ${ticket.ticketId}`);
    } catch (err) {
      this.logger.error(`[automation] onTicketCreated failed: ${err}`);
    }
  }

  // ── Daily overdue check at 09:00 ─────────────────────────────────────────────
  @Cron('0 9 * * *', { name: 'overdue-check' })
  async checkOverdueTickets() {
    this.logger.log('[automation] Running overdue ticket check…');

    const openTickets = await this.prisma.ticket.findMany({
      where: { status: { notIn: ['DONE', 'CLOSED'] } },
      select: {
        id:          true,
        ticketId:    true,
        title:       true,
        priority:    true,
        status:      true,
        createdAt:   true,
        updatedAt:   true,
        cancelledAt: true,
        isBlocked:   true,
        blockedAt:   true,
        actualStartAt: true,
        executionDueAt: true,
        reviewDueAt: true,
        reviewStartedAt: true,
        submittedAt: true,
        estimatedMinutes: true,
        dueDate:     true,
        scheduledStartAt: true,
        assignedToId: true,
      },
    });

    const config = await this.ticketTiming.getSlaConfig();

    let notified = 0;

    for (const ticket of openTickets) {
      const timing = this.ticketTiming.getTimingState(ticket, config);

      if (timing.isOverdue && ticket.assignedToId) {
        const overduByHours = Math.round(timing.overdueMs / 3_600_000);
        const overduBy = overduByHours > 0 ? overduByHours : 1; // at least 1 hr for message

        try {
          // Avoid duplicate: skip if an overdue notification was sent in the last 24 h
          const recent = await this.prisma.notification.findFirst({
            where: {
              userId:    ticket.assignedToId,
              link:      `/tickets/${ticket.id}`,
              title:     { contains: 'overdue' },
              createdAt: { gte: new Date(this.tva.now().getTime() - 24 * 3_600_000) },
            },
          });

          if (!recent) {
            await this.prisma.notification.create({
              data: {
                userId:  ticket.assignedToId,
                title:   `Ticket overdue: ${ticket.ticketId}`,
                message: `${ticket.title} is overdue by ${overduBy} hour${overduBy !== 1 ? 's' : ''}`,
                type:    NotificationType.WARNING,
                isRead:  false,
                link:    `/tickets/${ticket.id}`,
              },
            });
            notified++;
          }
        } catch (_e) { /* skip single failures */ }
      }
    }

    this.logger.log(
      `[automation] Overdue check complete — ${openTickets.length} open, ${notified} new overdue notifications sent`,
    );
  }
}
