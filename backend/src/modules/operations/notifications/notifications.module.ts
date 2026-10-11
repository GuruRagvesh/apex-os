import { Module, forwardRef } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationEventService } from './notification-event.service';
import { UsersModule } from '../../core/users/users.module';
import { GatewayModule } from '../../platform/gateway/gateway.module';
import { ConfigModule } from '@nestjs/config';
import { PushNotificationService } from './push-notification.service';

@Module({
  imports: [ConfigModule, forwardRef(() => UsersModule), GatewayModule],
  providers: [NotificationsService, NotificationEventService, PushNotificationService],
  controllers: [NotificationsController],
  exports: [NotificationsService, NotificationEventService, PushNotificationService],
})
export class NotificationsModule {}
