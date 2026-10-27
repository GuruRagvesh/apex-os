import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../../../operations/notifications/notifications.module';
import { RegularizationService } from './regularization.service';
import { RegularizationController } from './regularization.controller';
import { DailyAttendanceModule } from '../evaluation/daily-attendance.module';
import { SettingsModule } from '../../settings/settings.module';
import { CorrectionAuthorityService } from './correction-authority.service';
import { CorrectionDecisionService } from './correction-decision.service';

/**
 * Attendance regularization (AR-1).
 *
 * Depends on the AE-1 evaluator so a corrected day is re-explained by the same
 * rules that produced the original answer. HierarchyApprovalService,
 * AccessPolicyService and EventLoggerService come from the global CommonModule,
 * which is exactly the point: corrections reuse the company's existing
 * hierarchy, HR and audit conventions rather than defining their own.
 */
@Module({
  imports: [DailyAttendanceModule, SettingsModule, forwardRef(() => NotificationsModule)],
  controllers: [RegularizationController],
  providers: [RegularizationService, CorrectionAuthorityService, CorrectionDecisionService],
  exports: [RegularizationService, CorrectionAuthorityService, CorrectionDecisionService],
})
export class RegularizationModule {}
