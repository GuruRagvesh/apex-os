import { Module } from '@nestjs/common';
import { AttendanceConsoleService } from './attendance-console.service';
import { AttendanceConsoleController } from './attendance-console.controller';
import { DailyAttendanceModule } from '../evaluation/daily-attendance.module';
import { AttendanceProcessingModule } from '../processing/attendance-processing.module';
import { BusinessCalendarModule } from '../calendar/business-calendar.module';
import { LeaveModule } from '../../../operations/leave/leave.module';

/**
 * HR attendance console (HC-1).
 *
 * Imports the AE-1 evaluator, the business calendar and the leave balance
 * service: the console operates the existing services rather than owning any
 * attendance rule. The monthly register asks the calendar what a working day
 * is and asks Leave what a balance is, rather than counting either itself.
 * Hierarchy, access policy and audit come from the global CommonModule.
 */
@Module({
  imports: [
    DailyAttendanceModule,
    AttendanceProcessingModule,
    BusinessCalendarModule,
    LeaveModule,
  ],
  controllers: [AttendanceConsoleController],
  providers: [AttendanceConsoleService],
  exports: [AttendanceConsoleService],
})
export class AttendanceConsoleModule {}
