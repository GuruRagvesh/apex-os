import { Global, Module } from '@nestjs/common';
import { EventLoggerService } from './services/event-logger.service';
import { LeaveAccessService } from './services/leave-access.service';
import { TicketTimingService } from './services/ticket-timing.service';
import { TicketAccessService } from './services/ticket-access.service';
import { AccessPolicyService } from './services/access-policy.service';
import { HierarchyApprovalService } from './services/hierarchy-approval.service';
import { CompanyDateService } from './services/company-date.service';
import { AttendanceAuthorityService } from './services/attendance-authority.service';
import { TVAService } from './services/tva.service';
import { TvaController } from './controllers/tva.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [TvaController],
  providers: [
    EventLoggerService,
    AccessPolicyService,
    HierarchyApprovalService,
    TicketAccessService,
    TicketTimingService,
    LeaveAccessService,
    CompanyDateService,
    AttendanceAuthorityService,
    TVAService,
  ],
  exports: [
    EventLoggerService,
    AccessPolicyService,
    HierarchyApprovalService,
    TicketAccessService,
    TicketTimingService,
    LeaveAccessService,
    CompanyDateService,
    AttendanceAuthorityService,
    TVAService,
  ],
})
export class CommonModule {}
