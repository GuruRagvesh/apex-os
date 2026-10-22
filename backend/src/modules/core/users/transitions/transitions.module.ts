import { Module, forwardRef } from '@nestjs/common';
import { UsersModule } from '../users.module';
import { LeaveModule } from '../../../operations/leave/leave.module';
import { NotificationsModule } from '../../../operations/notifications/notifications.module';
import { GatewayModule } from '../../../platform/gateway/gateway.module';
import { TransitionsController } from './transitions.controller';
import { TransferService } from './transfer/transfer.service';
import { ExitService } from './exit/exit.service';
import { ClearanceService } from './exit/clearance.service';
import { SeparationService } from './exit/separation.service';
import { FnfService } from './fnf/fnf.service';
import { RetentionProposalsService } from './compliance/retention-proposals.service';
import { LegalHoldsService } from './compliance/legal-holds.service';
import { TransitionsSchedulerService } from './transitions-scheduler.service';

/**
 * Phase 4. A separate module because it needs LeaveModule (rerouting) and
 * LeaveModule already imports UsersModule; putting these providers inside
 * UsersModule would make that a cycle.
 */
@Module({
  imports: [UsersModule, LeaveModule, forwardRef(() => NotificationsModule), GatewayModule],
  controllers: [TransitionsController],
  providers: [
    TransferService, ExitService, ClearanceService, SeparationService, FnfService,
    RetentionProposalsService, LegalHoldsService, TransitionsSchedulerService,
  ],
  exports: [TransferService, ExitService, FnfService],
})
export class TransitionsModule {}
