import { Module } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { LeaveController } from './leave.controller';
import { LeaveBalanceService } from './leave-balance.service';
import { GatewayModule } from '../../platform/gateway/gateway.module';
import { EmailModule } from '../../platform/email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../../platform/settings/settings.module';
import { LeaveWorkingDayService } from './leave-working-day.service';
import { LeaveSettlementService } from './leave-settlement.service';
import { EmployeeTimelineModule } from '../../platform/attendance/timeline/employee-timeline.module';
import { BusinessCalendarModule } from '../../platform/attendance/calendar/business-calendar.module';
import { CompOffService } from './comp-off.service';
import { CompOffController } from './comp-off.controller';

@Module({
  imports: [
    GatewayModule,
    EmailModule,
    NotificationsModule,
    SettingsModule,
    // LH-1: leave consumes the attendance foundation as the calendar authority
    // instead of keeping its own holiday and weekly-off rules.
    EmployeeTimelineModule,
    BusinessCalendarModule,
  ],
  providers: [LeaveService, LeaveBalanceService, LeaveWorkingDayService, LeaveSettlementService, CompOffService],
  controllers: [LeaveController, CompOffController],
  exports: [LeaveService, LeaveBalanceService, LeaveWorkingDayService, LeaveSettlementService, CompOffService],
})
export class LeaveModule {}
