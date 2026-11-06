jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

import * as webPush from 'web-push';
import { PushNotificationService } from '../../src/modules/operations/notifications/push-notification.service';

describe('PushNotificationService', () => {
  const now = new Date('2026-10-05T06:30:00.000Z'); // 12:00 Asia/Kolkata
  const prisma: any = {
    appSetting: { findUnique: jest.fn() },
    pushSubscription: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    notification: { update: jest.fn(), findMany: jest.fn() },
  };
  const tva: any = { now: jest.fn(() => now), companyTimezone: jest.fn(() => 'Asia/Kolkata') };
  const configuredValues: Record<string, string> = {
    VAPID_PUBLIC_KEY: 'public-key',
    VAPID_PRIVATE_KEY: 'private-key',
    VAPID_SUBJECT: 'mailto:ops@example.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.appSetting.findUnique.mockResolvedValue(null);
    prisma.notification.update.mockResolvedValue({});
    prisma.pushSubscription.update.mockResolvedValue({});
  });

  function service(values = configuredValues) {
    return new PushNotificationService(
      prisma,
      { get: jest.fn((key: string) => values[key]) } as any,
      tva,
    );
  }

  it('reports disabled configuration without exposing a partial key', () => {
    expect(service({ VAPID_PUBLIC_KEY: 'public-only' }).getPublicConfiguration()).toEqual({
      enabled: false,
      publicKey: null,
    });
  });

  it('upserts a validated browser subscription for the authenticated user', async () => {
    prisma.pushSubscription.upsert.mockResolvedValue({ id: 'subscription-1' });

    await service().subscribe('user-1', {
      endpoint: 'https://push.example/subscription',
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
    }, 'test-agent');

    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { endpoint: 'https://push.example/subscription' },
      create: expect.objectContaining({ userId: 'user-1', userAgent: 'test-agent' }),
      update: expect.objectContaining({ userId: 'user-1', disabledAt: null, failureCount: 0 }),
    }));
  });

  it('delivers an unread notification and records successful delivery', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([{
      id: 'subscription-1',
      endpoint: 'https://push.example/subscription',
      p256dh: 'p256dh-value',
      auth: 'auth-value',
    }]);
    (webPush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 });
    const notification = {
      id: 'notification-1', userId: 'user-1', title: 'Break ended',
      message: 'Return to work', link: '/dashboard', type: 'WARNING',
      isRead: false, pushDeliveredAt: null,
    };

    await expect(service().deliver(notification)).resolves.toBe(true);

    expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'notification-1' },
      data: { pushDeliveredAt: now },
    });
    expect(prisma.pushSubscription.update).toHaveBeenCalledWith({
      where: { id: 'subscription-1' },
      data: { lastSuccessAt: now, failureCount: 0 },
    });
  });

  it('sends a forced break alarm as an urgent, re-alerting push', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([{
      id: 'subscription-1', endpoint: 'https://push.example/subscription',
      p256dh: 'p256dh-value', auth: 'auth-value',
    }]);
    (webPush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 });

    await service().deliver({
      id: 'notification-2', userId: 'user-1', title: 'Your planned break has ended',
      message: 'Reminder 2 of 3', link: '/dashboard', type: 'WARNING',
      entityType: 'BREAK', entityId: 'break-1', isRead: false, pushDeliveredAt: null,
    }, true);

    const [, payload, options] = (webPush.sendNotification as jest.Mock).mock.calls[0];
    expect(options).toEqual({ TTL: 20 * 60, urgency: 'high' });
    expect(JSON.parse(payload)).toMatchObject({ tag: 'break-break-1', alarm: true });
  });

  it('disables an expired browser subscription without losing the notification', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([{
      id: 'subscription-1', endpoint: 'https://push.example/expired',
      p256dh: 'p256dh-value', auth: 'auth-value',
    }]);
    (webPush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 410 });

    await expect(service().deliver({
      id: 'notification-1', userId: 'user-1', title: 'Title', message: 'Body',
      isRead: false, pushDeliveredAt: null,
    })).resolves.toBe(false);

    expect(prisma.pushSubscription.update).toHaveBeenCalledWith({
      where: { id: 'subscription-1' },
      data: { disabledAt: now, failureCount: { increment: 1 } },
    });
  });
});
