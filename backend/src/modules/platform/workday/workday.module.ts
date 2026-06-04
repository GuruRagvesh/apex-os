import { Module } from '@nestjs/common';
import { WorkdayController } from './workday.controller';
import { WorkdayService } from './workday.service';
import { NotificationsModule } from '../../operations/notifications/notifications.module';
import { TicketsModule } from '../../operations/tickets/tickets.module'; // for ticketLedger if needed

@Module({
  imports: [NotificationsModule, TicketsModule],
  controllers: [WorkdayController],
  providers: [WorkdayService],
  exports: [WorkdayService],
})
export class WorkdayModule {}
