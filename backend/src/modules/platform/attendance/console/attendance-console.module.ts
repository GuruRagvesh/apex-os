import { Module } from '@nestjs/common';
import { AttendanceConsoleService } from './attendance-console.service';
import { AttendanceConsoleController } from './attendance-console.controller';
import { DailyAttendanceModule } from '../evaluation/daily-attendance.module';
import { AttendanceProcessingModule } from '../processing/attendance-processing.module';

/**
 * HR attendance console (HC-1).
 *
 * Imports the AE-1 evaluator and nothing else of its own: the console operates
 * the existing services rather than owning any attendance rule. Hierarchy,
 * access policy and audit come from the global CommonModule.
 */
@Module({
  imports: [DailyAttendanceModule, AttendanceProcessingModule],
  controllers: [AttendanceConsoleController],
  providers: [AttendanceConsoleService],
  exports: [AttendanceConsoleService],
})
export class AttendanceConsoleModule {}
