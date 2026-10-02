import { Module } from '@nestjs/common';
import { AttendanceReportService } from './attendance-report.service';
import { AttendanceReportController } from './attendance-report.controller';
import { MyAttendanceController } from './my-attendance.controller';
import { BusinessCalendarModule } from '../calendar/business-calendar.module';

/**
 * The canonical attendance report.
 *
 * Deliberately thin on imports. It reads stored facts and the business
 * calendar, and it does NOT import the evaluator -- a report that could
 * evaluate would eventually re-decide a finalized month, which is the defect
 * GET /attendance/daily still has. Access policy and TVA come from the global
 * CommonModule.
 */
@Module({
  imports: [BusinessCalendarModule],
  // Two controllers, one service. The employee view and the HR report are
  // the same assembly scoped differently, which is what keeps them agreeing.
  controllers: [AttendanceReportController, MyAttendanceController],
  providers: [AttendanceReportService],
  exports: [AttendanceReportService],
})
export class AttendanceReportModule {}
