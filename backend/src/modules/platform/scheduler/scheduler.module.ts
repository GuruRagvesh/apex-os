import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { GatewayModule } from '../gateway/gateway.module';
import { TicketsModule } from '../../operations/tickets/tickets.module';
import { NotificationsModule } from '../../operations/notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [GatewayModule, TicketsModule, NotificationsModule, SettingsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
