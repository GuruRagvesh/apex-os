import { Module } from '@nestjs/common';
import { DailyAttendanceModule } from '../evaluation/daily-attendance.module';
import { MyAttendanceV2Controller } from './my-attendance-v2.controller';
import { MyAttendanceV2Service } from './my-attendance-v2.service';
import { BusinessCalendarModule } from '../calendar/business-calendar.module';
import { EmployeeTimelineModule } from '../timeline/employee-timeline.module';

/**
 * My Attendance V2 read surface.
 *
 * Imports the evaluation module to reuse the ONE evaluator rather than reading
 * DailyAttendance directly — a second reader would be a second interpretation,
 * which is the defect the canonical audit exists to prevent.
 *
 * The service is also exported to hierarchy-authorized internal readers so a
 * leader calendar cannot drift from the employee's canonical day result.
 */
@Module({
  imports: [DailyAttendanceModule, BusinessCalendarModule, EmployeeTimelineModule],
  controllers: [MyAttendanceV2Controller],
  providers: [MyAttendanceV2Service],
  exports: [MyAttendanceV2Service],
})
export class MyAttendanceV2Module {}
