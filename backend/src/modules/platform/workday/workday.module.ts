import { Module } from '@nestjs/common';
import { WorkdayController } from './workday.controller';
import { WorkdayService } from './workday.service';
import { NotificationsModule } from '../../operations/notifications/notifications.module';
import { TicketsModule } from '../../operations/tickets/tickets.module'; // for ticketLedger if needed
import { WorkdayNotesController } from './workday-notes.controller';
import { WorkdayNotesService } from './workday-notes.service';

@Module({
  imports: [NotificationsModule, TicketsModule],
  controllers: [WorkdayController, WorkdayNotesController],
  providers: [WorkdayService, WorkdayNotesService],
  exports: [WorkdayService],
})
export class WorkdayModule {}
