import { Module } from '@nestjs/common';
import { DailyAttendanceModule } from '../evaluation/daily-attendance.module';
import { MyAttendanceV2Controller } from './my-attendance-v2.controller';
import { MyAttendanceV2Service } from './my-attendance-v2.service';

/**
 * My Attendance V2 read surface.
 *
 * Imports the evaluation module to reuse the ONE evaluator rather than reading
 * DailyAttendance directly — a second reader would be a second interpretation,
 * which is the defect the canonical audit exists to prevent.
 *
 * Exports nothing. This is a leaf: a read surface for one page, with no other
 * module depending on it, so withdrawing it is a deletion.
 */
@Module({
  imports: [DailyAttendanceModule],
  controllers: [MyAttendanceV2Controller],
  providers: [MyAttendanceV2Service],
})
export class MyAttendanceV2Module {}
