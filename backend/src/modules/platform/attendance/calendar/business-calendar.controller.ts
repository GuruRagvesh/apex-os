import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { PolicyStatus } from '@prisma/client';

/**
 * The company holiday calendar, readable by any authenticated employee.
 *
 * Holidays were already imported and already drive the evaluator's working-day
 * decisions, but nothing exposed them over HTTP — so an employee could be
 * marked WEEKLY_OFF or HOLIDAY with no way to see which holidays exist.
 *
 * Read-only, and deliberately not per-employee: a company holiday is the same
 * fact for everyone, so this needs no scoping beyond being signed in. The
 * employee's OWN assigned calendar could differ in principle; resolving that
 * is the console's job, not this list's.
 */
@ApiTags('Attendance Calendar')
@Controller('attendance/calendar')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BusinessCalendarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
  ) {}

  /**
   * Holidays for a financial year, defaulting to the current one.
   *
   * `upcoming` is derived from company time rather than the caller's clock, so
   * an employee in another timezone sees the same answer as the evaluator.
   */
  @Get('holidays')
  @ApiOperation({ summary: 'Company holidays for a financial year' })
  async holidays(@CurrentUser() _user: any, @Query('financialYear') financialYear?: string) {
    // TVA returns the year as an object; the column stores its label.
    const fy: string = financialYear ?? this.tva.financialYear().label;

    const calendar = await this.prisma.holidayCalendar.findFirst({
      where: { financialYear: fy, status: PolicyStatus.ACTIVE },
      orderBy: { version: 'desc' },
      select: { id: true, name: true, financialYear: true },
    });

    if (!calendar) {
      // An absent calendar is a real configuration state, not an empty list:
      // every working-day question resolves BLOCKED without one, and saying
      // "no holidays" would misrepresent that.
      return { financialYear: fy, calendarName: null, total: 0, upcoming: 0, holidays: [] };
    }

    const rows = await this.prisma.holiday.findMany({
      where: { calendarId: calendar.id },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, name: true, isOptional: true },
    });

    const today = this.tva.companyDateOnly(this.tva.now());
    const holidays = rows.map((h) => ({
      id: h.id,
      date: h.date.toISOString().slice(0, 10),
      name: h.name,
      isOptional: h.isOptional,
      past: h.date.getTime() < today.getTime(),
    }));

    return {
      financialYear: calendar.financialYear,
      calendarName: calendar.name,
      total: holidays.length,
      upcoming: holidays.filter((h) => !h.past).length,
      holidays,
    };
  }
}
