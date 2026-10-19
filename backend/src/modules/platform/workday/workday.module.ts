import { Module } from '@nestjs/common';
import { WorkdayController } from './workday.controller';
import { WorkdayService } from './workday.service';
import { NotificationsModule } from '../../operations/notifications/notifications.module';
import { TicketsModule } from '../../operations/tickets/tickets.module'; // for ticketLedger if needed
import { WorkdayNotesController } from './workday-notes.controller';
import { WorkdayNotesService } from './workday-notes.service';
import { MeetingService } from './meeting.service';
import { MeetingV2Service } from './meeting-v2.service';
import { MeetingV2Controller } from './meeting-v2.controller';

@Module({
  imports: [NotificationsModule, TicketsModule],
  controllers: [WorkdayController, WorkdayNotesController, MeetingV2Controller],
  providers: [WorkdayService, WorkdayNotesService, MeetingService, MeetingV2Service],
  exports: [WorkdayService, MeetingService, MeetingV2Service],
})
export class WorkdayModule {}
