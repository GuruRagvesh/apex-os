import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { PushNotificationService } from './push-notification.service';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private pushNotifications: PushNotificationService,
  ) {}

  getPushConfiguration() {
    return this.pushNotifications.getPublicConfiguration();
  }

  subscribe(userId: string, subscription: any, userAgent?: string | null) {
    return this.pushNotifications.subscribe(userId, subscription, userAgent);
  }

  unsubscribe(userId: string, endpoint: unknown) {
    return this.pushNotifications.unsubscribe(userId, endpoint);
  }

  async findByUser(userId: string, onlyUnread = false) {
    return this.prisma.notification.findMany({
      where: { userId, ...(onlyUnread ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async create(
    userId: string,
    title: string,
    message: string,
    type: NotificationType = NotificationType.INFO,
    link?: string,
    entityId?: string,
    entityType?: string,
  ) {
    return this.prisma.notification.create({
      data: { userId, title, message, type, link, entityId, entityType },
    });
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
    return { count };
  }

  async findById(id: string) {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  async remove(id: string) {
    return this.prisma.notification.delete({ where: { id } });
  }
}
