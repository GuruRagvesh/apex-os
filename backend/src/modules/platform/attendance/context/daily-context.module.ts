import { Module } from '@nestjs/common';
import { DailyContextService } from './daily-context.service';
import { BusinessCalendarModule } from '../calendar/business-calendar.module';
import { EmployeeTimelineModule } from '../timeline/employee-timeline.module';
import { PolicyVersionModule } from '../policy/policy-version.module';

/**
 * Daily Attendance Context (Attendance Base Layer, BL-5).
 *
 * The first module that composes the base layer rather than adding to it.
 * Still no controller: the context is an internal contract for the future
 * attendance engine, not a public surface, until BL-6 defines permissions.
 */
@Module({
  imports: [BusinessCalendarModule, EmployeeTimelineModule, PolicyVersionModule],
  providers: [DailyContextService],
  exports: [DailyContextService],
})
export class DailyContextModule {}
