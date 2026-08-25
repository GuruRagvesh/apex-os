import { Module } from '@nestjs/common';
import { BusinessCalendarService } from './business-calendar.service';

/**
 * Business Calendar (Attendance Base Layer, BL-2A).
 *
 * Deliberately has no controller yet: nothing outside the Attendance layers
 * should reach the calendar over HTTP until the employee timeline (BL-3) and
 * the admin surface (BL-6) exist. TVAService and PrismaService both arrive
 * through the global CommonModule, so no imports are needed here.
 */
@Module({
  providers: [BusinessCalendarService],
  exports: [BusinessCalendarService],
})
export class BusinessCalendarModule {}
