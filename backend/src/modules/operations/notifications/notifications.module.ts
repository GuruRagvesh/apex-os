import { Module, forwardRef } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationEventService } from './notification-event.service';
import { UsersModule } from '../../core/users/users.module';
import { GatewayModule } from '../../platform/gateway/gateway.module';

@Module({
  imports: [forwardRef(() => UsersModule), GatewayModule],
  providers: [NotificationsService, NotificationEventService],
  controllers: [NotificationsController],
  exports: [NotificationsService, NotificationEventService],
})
export class NotificationsModule {}
