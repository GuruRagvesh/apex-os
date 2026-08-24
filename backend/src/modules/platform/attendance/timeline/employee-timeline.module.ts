import { Module } from '@nestjs/common';
import { EmployeeTimelineService } from './employee-timeline.service';

/**
 * Employee Attendance Timeline (Attendance Base Layer, BL-3).
 *
 * No controller yet, for the same reason as the calendar module: nothing
 * outside the Attendance layers should reach the timeline over HTTP until the
 * admin surface (BL-6) exists and its permissions are defined. TVAService and
 * PrismaService arrive through the global CommonModule.
 */
@Module({
  providers: [EmployeeTimelineService],
  exports: [EmployeeTimelineService],
})
export class EmployeeTimelineModule {}
