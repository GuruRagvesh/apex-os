import { Module, Global } from '@nestjs/common';
import { EventLoggerService } from './services/event-logger.service';
import { AccessPolicyService } from './services/access-policy.service';
import { TicketAccessService } from './services/ticket-access.service';
import { TicketTimingService } from './services/ticket-timing.service';
import { LeaveAccessService } from './services/leave-access.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [EventLoggerService, AccessPolicyService, TicketAccessService, TicketTimingService, LeaveAccessService],
  exports: [EventLoggerService, AccessPolicyService, TicketAccessService, TicketTimingService, LeaveAccessService],
})
export class CommonModule {}
