import { Module } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { LeaveController } from './leave.controller';
import { LeaveBalanceService } from './leave-balance.service';
import { GatewayModule } from '../../platform/gateway/gateway.module';
import { EmailModule } from '../../platform/email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../../platform/settings/settings.module';

@Module({
  imports: [GatewayModule, EmailModule, NotificationsModule, SettingsModule],
  providers: [LeaveService, LeaveBalanceService],
  controllers: [LeaveController],
  exports: [LeaveService, LeaveBalanceService],
})
export class LeaveModule {}
