import { Module } from '@nestjs/common';
import { BusinessCalendarService } from './business-calendar.service';
import { BusinessCalendarController } from './business-calendar.controller';

/**
 * Business Calendar (Attendance Base Layer, BL-2A).
 *
 * Now carries one read-only controller: the company holiday list. Holidays
 * already drive the evaluator's working-day decisions, but nothing exposed
 * them, so an employee could be marked HOLIDAY with no way to see which
 * holidays exist. TVAService and PrismaService both arrive through the global
 * CommonModule, so no imports are needed here.
 */
@Module({
  controllers: [BusinessCalendarController],
  providers: [BusinessCalendarService],
  exports: [BusinessCalendarService],
})
export class BusinessCalendarModule {}
