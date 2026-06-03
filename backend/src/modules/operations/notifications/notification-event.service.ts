import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { UsersService } from '../../core/users/users.service';
import { NotificationType } from '@prisma/client';

const NOTIF_DEFAULTS = {
  assignedTicket: true,
  statusChanged:  true,
  commentAdded:   false,
  overdueTicket:  true,
  ticketResolved: true,
  ticketBlocked:  true,
  leaveApproved:  true,
  leaveRejected:  true,
  teamLeaveApply: true,
  inApp:          true,
  quietFrom:      '22:00',
  quietTo:        '08:00',
  timezone:       'Asia/Kolkata',
};

@Injectable()
export class NotificationEventService {
  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
  ) {}

  async sendNotification(
    userId: string,
    eventKey: string,
    notificationData: {
      title: string;
      message: string;
      type: NotificationType;
      link?: string;
      entityId?: string;
      entityType?: string;
    }
  ) {
    // 1. Fetch user preferences
    let prefs: any = {};
    try {
      prefs = await this.usersService.getPreferences(userId);
    } catch (e) {
      // Fallback
    }
    const resolvedPrefs = { ...NOTIF_DEFAULTS, ...prefs };

    // 2. Check notification preference
    if (eventKey && resolvedPrefs[eventKey] === false) {
      return null;
    }

    // 3. Create persistent notification in database
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title: notificationData.title,
        message: notificationData.message,
        type: notificationData.type,
        link: notificationData.link,
        entityId: notificationData.entityId,
        entityType: notificationData.entityType,
      },
    });

    // 4. Check quiet hours for real-time socket delivery
    const quietFrom = resolvedPrefs.quietFrom || '22:00';
    const quietTo = resolvedPrefs.quietTo || '08:00';
    const userTimezone = resolvedPrefs.timezone || 'Asia/Kolkata';

    const inQuietHours = this.isInQuietHours(quietFrom, quietTo, userTimezone);

    if (!inQuietHours && resolvedPrefs.inApp !== false) {
      // 5. Deliver real-time socket notification
      this.gateway.emitNotificationToUser(userId, notification);
    }

    return notification;
  }

  isInQuietHours(from: string, to: string, timezone: string, now = new Date()): boolean {
    if (!from || !to) return false;

    let localTime: Date;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const dateMap: Record<string, number> = {};
      for (const part of parts) {
        if (part.type !== 'literal') {
          dateMap[part.type] = Number(part.value);
        }
      }
      localTime = new Date(
        dateMap.year,
        dateMap.month - 1,
        dateMap.day,
        dateMap.hour === 24 ? 0 : dateMap.hour,
        dateMap.minute,
        dateMap.second,
      );
    } catch (e) {
      localTime = now;
    }

    const [fHr, fMin] = from.split(':').map(Number);
    const [tHr, tMin] = to.split(':').map(Number);

    const currentMin = localTime.getHours() * 60 + localTime.getMinutes();
    const startMin = fHr * 60 + fMin;
    const endMin = tHr * 60 + tMin;

    if (startMin <= endMin) {
      return currentMin >= startMin && currentMin <= endMin;
    } else {
      return currentMin >= startMin || currentMin <= endMin;
    }
  }
}
