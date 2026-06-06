import { Global, Module } from '@nestjs/common';
import { EventLoggerService } from './services/event-logger.service';
import { LeaveAccessService } from './services/leave-access.service';
import { TicketTimingService } from './services/ticket-timing.service';
import { TicketAccessService } from './services/ticket-access.service';
import { AccessPolicyService } from './services/access-policy.service';
import { CompanyDateService } from './services/company-date.service';
import { AttendanceAuthorityService } from './services/attendance-authority.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    EventLoggerService,
    AccessPolicyService,
    TicketAccessService,
    TicketTimingService,
    LeaveAccessService,
    CompanyDateService,
    AttendanceAuthorityService,
  ],
  exports: [
    EventLoggerService,
    AccessPolicyService,
    TicketAccessService,
    TicketTimingService,
    LeaveAccessService,
    CompanyDateService,
    AttendanceAuthorityService,
  ],
})
export class CommonModule {}
