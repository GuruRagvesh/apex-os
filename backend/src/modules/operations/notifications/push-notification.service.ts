import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as webPush from 'web-push';
import { PrismaService } from '../../../prisma/prisma.service';
import { TVAService } from '../../../common/services/tva.service';

type BrowserSubscription = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private readonly publicKey: string;
  private readonly configured: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tva: TVAService,
  ) {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY')?.trim() ?? '';
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY')?.trim() ?? '';
    const subject = this.config.get<string>('VAPID_SUBJECT')?.trim() || 'mailto:admin@example.com';
    this.publicKey = publicKey;
    this.configured = Boolean(publicKey && privateKey);
    if (this.configured) webPush.setVapidDetails(subject, publicKey, privateKey);
  }

  getPublicConfiguration() {
    return { enabled: this.configured, publicKey: this.configured ? this.publicKey : null };
  }

  async subscribe(userId: string, input: BrowserSubscription, userAgent?: string | null) {
    if (!this.configured) throw new ServiceUnavailableException('Push notifications are not configured');
    const endpoint = typeof input?.endpoint === 'string' ? input.endpoint.trim() : '';
    const p256dh = typeof input?.keys?.p256dh === 'string' ? input.keys.p256dh.trim() : '';
    const auth = typeof input?.keys?.auth === 'string' ? input.keys.auth.trim() : '';
    if (!endpoint.startsWith('https://') || endpoint.length > 2048 || !p256dh || !auth) {
      throw new BadRequestException('A valid browser push subscription is required');
    }

    return this.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh, auth, userAgent: userAgent?.slice(0, 500) || null },
      update: {
        userId,
        p256dh,
        auth,
        userAgent: userAgent?.slice(0, 500) || null,
        disabledAt: null,
        failureCount: 0,
      },
      select: { id: true, createdAt: true, updatedAt: true },
    });
  }

  async unsubscribe(userId: string, endpoint: unknown) {
    if (typeof endpoint !== 'string' || !endpoint) throw new BadRequestException('endpoint is required');
    return this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  private async pushAllowed(userId: string, now: Date): Promise<boolean> {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: `user-prefs-${userId}` } });
    const prefs: any = setting?.value ?? {};
    if (prefs.pushEnabled === false) return false;
    const from = String(prefs.quietFrom || '22:00');
    const to = String(prefs.quietTo || '08:00');
    const timezone = String(prefs.timezone || this.tva.companyTimezone());
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const values: Record<string, number> = {};
    for (const part of parts) if (part.type !== 'literal') values[part.type] = Number(part.value);
    const current = (values.hour === 24 ? 0 : values.hour) * 60 + values.minute;
    const [fromHour, fromMinute] = from.split(':').map(Number);
    const [toHour, toMinute] = to.split(':').map(Number);
    const start = fromHour * 60 + fromMinute;
    const end = toHour * 60 + toMinute;
    const quiet = start <= end ? current >= start && current <= end : current >= start || current <= end;
    return !quiet;
  }

  async deliver(notification: any): Promise<boolean> {
    if (!this.configured || notification.pushDeliveredAt || notification.isRead) return false;
    const now = this.tva.now();
    if (!(await this.pushAllowed(notification.userId, now))) return false;
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId: notification.userId, disabledAt: null },
    });
    if (subscriptions.length === 0) return false;

    await this.prisma.notification.update({ where: { id: notification.id }, data: { pushAttemptedAt: now } });
    const payload = JSON.stringify({
      notificationId: notification.id,
      title: notification.title,
      body: notification.message,
      url: notification.link || '/dashboard',
      type: notification.type,
    });
    let delivered = false;

    for (const subscription of subscriptions) {
      try {
        await webPush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 60 * 60, urgency: 'normal' });
        delivered = true;
        await this.prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { lastSuccessAt: now, failureCount: 0 },
        });
      } catch (error: any) {
        const gone = error?.statusCode === 404 || error?.statusCode === 410;
        await this.prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: gone
            ? { disabledAt: now, failureCount: { increment: 1 } }
            : { failureCount: { increment: 1 } },
        });
        if (!gone) this.logger.warn(`Push delivery failed for subscription ${subscription.id}: ${error?.message ?? error}`);
      }
    }

    if (delivered) {
      await this.prisma.notification.update({ where: { id: notification.id }, data: { pushDeliveredAt: now } });
    }
    return delivered;
  }

  /** Retries recent unread notifications created by legacy/direct producers. */
  @Cron('* * * * *', { name: 'push-notification-delivery' })
  async deliverPending() {
    if (!this.configured) return;
    const now = this.tva.now();
    const retryBefore = new Date(now.getTime() - 5 * 60_000);
    const recent = new Date(now.getTime() - 24 * 60 * 60_000);
    const notifications = await this.prisma.notification.findMany({
      where: {
        isRead: false,
        pushDeliveredAt: null,
        createdAt: { gte: recent },
        OR: [{ pushAttemptedAt: null }, { pushAttemptedAt: { lte: retryBefore } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const notification of notifications) {
      try { await this.deliver(notification); }
      catch (error: any) { this.logger.warn(`Pending push ${notification.id} failed: ${error?.message ?? error}`); }
    }
  }
}
