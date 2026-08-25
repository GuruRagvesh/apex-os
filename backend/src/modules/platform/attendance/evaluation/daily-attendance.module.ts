import { Module } from '@nestjs/common';
import { DailyAttendanceEvaluatorService } from './daily-attendance-evaluator.service';
import { LeaveFactsService } from './leave-facts.service';
import { DailyAttendanceController } from './daily-attendance.controller';
import { DailyContextModule } from '../context/daily-context.module';

/**
 * Daily Attendance evaluation (AE-1).
 *
 * Depends on the BL-5 context resolver and reads the existing Leave tables
 * directly through Prisma. It deliberately does NOT import the Leave module:
 * this wave consumes leave facts and must not be able to create, approve or
 * deduct anything.
 */
@Module({
  imports: [DailyContextModule],
  controllers: [DailyAttendanceController],
  providers: [DailyAttendanceEvaluatorService, LeaveFactsService],
  exports: [DailyAttendanceEvaluatorService],
})
export class DailyAttendanceModule {}
