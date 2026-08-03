import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { GatewayModule } from '../gateway/gateway.module';
import { TicketsModule } from '../../operations/tickets/tickets.module';
import { NotificationsModule } from '../../operations/notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { WorkdayModule } from '../workday/workday.module';

@Module({
  imports: [GatewayModule, TicketsModule, NotificationsModule, SettingsModule, WorkdayModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
