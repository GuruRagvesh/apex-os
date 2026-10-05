import { Module } from '@nestjs/common';
import { DailyContextModule } from '../context/daily-context.module';
import { DailyAttendanceModule } from '../evaluation/daily-attendance.module';
import { EmployeeAttendanceSummaryService } from './employee-attendance-summary.service';
import { EmployeeAttendanceSummaryController } from './employee-attendance-summary.controller';

/**
 * The employee Attendance dashboard's read model.
 *
 * DailyContextModule for the required-presence resolver's inputs and
 * employment category; DailyAttendanceModule for the same evaluator every
 * other Attendance surface reads from, so today's live figure is never a
 * second interpretation. AccessPolicyService, PrismaService and TVAService
 * come from the global CommonModule.
 */
@Module({
  imports: [DailyContextModule, DailyAttendanceModule],
  controllers: [EmployeeAttendanceSummaryController],
  providers: [EmployeeAttendanceSummaryService],
  exports: [EmployeeAttendanceSummaryService],
})
export class EmployeeAttendanceSummaryModule {}
