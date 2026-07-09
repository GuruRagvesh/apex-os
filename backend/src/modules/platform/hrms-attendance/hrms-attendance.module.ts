import { Module } from '@nestjs/common';
import { HrmsAttendanceController } from './hrms-attendance.controller';
import { HrmsAttendanceService } from './hrms-attendance.service';
import { WorkdayModule } from '../workday/workday.module';

@Module({
  imports: [WorkdayModule],
  controllers: [HrmsAttendanceController],
  providers: [HrmsAttendanceService],
  exports: [HrmsAttendanceService],
})
export class HrmsAttendanceModule {}
