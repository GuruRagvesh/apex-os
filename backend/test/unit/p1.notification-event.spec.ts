import { Test, TestingModule } from '@nestjs/testing';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { UsersService } from '../../src/modules/core/users/users.service';
import { NotificationType } from '@prisma/client';

const mockPrisma = {
  notification: {
    create: jest.fn(),
  },
};

const mockGateway = {
  emitNotificationToUser: jest.fn(),
};

const mockUsersService = {
  getPreferences: jest.fn(),
};

describe('NotificationEventService', () => {
  let service: NotificationEventService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationEventService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsGateway, useValue: mockGateway },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = module.get<NotificationEventService>(NotificationEventService);
  });

  describe('isInQuietHours', () => {
    it('returns false if current hour is outside quiet hours (non-crossing midnight)', () => {
      // quiet hours 22:00 to 08:00
      // Mock local hour to 12:00 (midday)
      const now = new Date('2026-03-02T12:00:00Z');
      const inQuiet = service.isInQuietHours('22:00', '08:00', 'UTC', now);
      expect(inQuiet).toBe(false);
    });

    it('returns true if current hour is within quiet hours (non-crossing midnight)', () => {
      // quiet hours 13:00 to 18:00
      // Mock local hour to 15:00
      const now = new Date('2026-03-02T15:00:00Z');
      const inQuiet = service.isInQuietHours('13:00', '18:00', 'UTC', now);
      expect(inQuiet).toBe(true);
    });

    it('returns true if current hour is within quiet hours crossing midnight (e.g. 22:00 to 08:00 at 23:00)', () => {
      const now = new Date('2026-03-02T23:30:00Z');
      const inQuiet = service.isInQuietHours('22:00', '08:00', 'UTC', now);
      expect(inQuiet).toBe(true);
    });

    it('returns true if current hour is within quiet hours crossing midnight (e.g. 22:00 to 08:00 at 06:00)', () => {
      const now = new Date('2026-03-02T06:15:00Z');
      const inQuiet = service.isInQuietHours('22:00', '08:00', 'UTC', now);
      expect(inQuiet).toBe(true);
    });

    it('correctly maps quiet hours to user timezone', () => {
      // User is in Asia/Kolkata (UTC+5:30)
      // Standard time is 22:00 IST = 16:30 UTC
      // If UTC time is 2026-03-02T17:00:00Z, then local IST time is 2026-03-02T22:30:00+05:30 (inside quiet hours)
      const now = new Date('2026-03-02T17:00:00Z');
      const inQuiet = service.isInQuietHours('22:00', '08:00', 'Asia/Kolkata', now);
      expect(inQuiet).toBe(true);
    });
  });

  describe('sendNotification', () => {
    it('does not create or send notification if preference for event is false', async () => {
      mockUsersService.getPreferences.mockResolvedValue({
        assignedTicket: false,
      });

      const result = await service.sendNotification('user1', 'assignedTicket', {
        title: 'New Assignment',
        message: 'You have been assigned a ticket',
        type: NotificationType.INFO,
      });

      expect(result).toBeNull();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(mockGateway.emitNotificationToUser).not.toHaveBeenCalled();
    });

    it('creates notification and emits socket if outside quiet hours', async () => {
      mockUsersService.getPreferences.mockResolvedValue({
        assignedTicket: true,
        quietFrom: '22:00',
        quietTo: '08:00',
        timezone: 'UTC',
      });
      mockPrisma.notification.create.mockResolvedValue({ id: 'notif1', title: 'New Assignment' });

      // Midday UTC (not in quiet hours)
      const now = new Date('2026-03-02T12:00:00Z');
      jest.spyOn(service, 'isInQuietHours').mockReturnValue(false);

      const result = await service.sendNotification('user1', 'assignedTicket', {
        title: 'New Assignment',
        message: 'You have been assigned a ticket',
        type: NotificationType.INFO,
      });

      expect(result).toEqual({ id: 'notif1', title: 'New Assignment' });
      expect(mockPrisma.notification.create).toHaveBeenCalled();
      expect(mockGateway.emitNotificationToUser).toHaveBeenCalledWith('user1', expect.anything());
    });

    it('creates notification in database but suppresses socket emit if in quiet hours', async () => {
      mockUsersService.getPreferences.mockResolvedValue({
        assignedTicket: true,
        quietFrom: '22:00',
        quietTo: '08:00',
        timezone: 'UTC',
      });
      mockPrisma.notification.create.mockResolvedValue({ id: 'notif1', title: 'New Assignment' });

      // Night UTC (in quiet hours)
      jest.spyOn(service, 'isInQuietHours').mockReturnValue(true);

      const result = await service.sendNotification('user1', 'assignedTicket', {
        title: 'New Assignment',
        message: 'You have been assigned a ticket',
        type: NotificationType.INFO,
      });

      expect(result).toEqual({ id: 'notif1', title: 'New Assignment' });
      expect(mockPrisma.notification.create).toHaveBeenCalled();
      expect(mockGateway.emitNotificationToUser).not.toHaveBeenCalled();
    });
  });
});
