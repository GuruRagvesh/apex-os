import { Module } from '@nestjs/common';
import { RegularizationService } from './regularization.service';
import { RegularizationController } from './regularization.controller';
import { DailyAttendanceModule } from '../evaluation/daily-attendance.module';
import { SettingsModule } from '../../settings/settings.module';

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
  imports: [DailyAttendanceModule, SettingsModule],
  controllers: [RegularizationController],
  providers: [RegularizationService],
  exports: [RegularizationService],
})
export class RegularizationModule {}
