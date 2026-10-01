import { Module } from '@nestjs/common';
import { AttendanceReportService } from './attendance-report.service';
import { AttendanceReportController } from './attendance-report.controller';
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
  controllers: [AttendanceReportController],
  providers: [AttendanceReportService],
  exports: [AttendanceReportService],
})
export class AttendanceReportModule {}
