import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { TVAService } from '../../../../common/services/tva.service';
import { MyAttendanceV2Service } from './my-attendance-v2.service';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * My Attendance V2 — the employee's own attendance, in the target day contract.
 *
 * ADDITIVE. The existing /attendance/daily routes are untouched and still serve
 * the live page; this is a parallel read surface for the hidden V2 route, so
 * either can be withdrawn without affecting the other.
 *
 * SELF-SCOPED BY CONSTRUCTION. Like the AE-1 controller it sits beside, there is
 * no userId parameter anywhere in this file, so no route here can be pointed at
 * another employee. A manager or HR view needs an authorization model this slice
 * does not define.
 *
 * READ-ONLY. Both routes evaluate and return; neither persists. A GET that wrote
 * an official attendance record would make the record depend on who opened the
 * page.
 */
@ApiTags('Attendance')
@Controller('attendance/me/v2')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MyAttendanceV2Controller {
  constructor(
    private readonly service: MyAttendanceV2Service,
    private readonly tva: TVAService,
  ) {}

  /**
   * Today plus one month of days.
   *
   * `month` defaults to the current company month. An invalid month is refused
   * rather than coerced: silently widening or narrowing the range would make
   * the calendar disagree with the URL.
   */
  @Get()
  @ApiOperation({ summary: "The authenticated employee's own attendance for a month" })
  async overview(@CurrentUser() user: any, @Query('month') month?: string) {
    const userId = user?.id ?? user?.sub;
    const requested = month ?? undefined;

    if (requested !== undefined && !MONTH_RE.test(requested)) {
      throw new BadRequestException('month must be a yyyy-MM value');
    }

    // The default month comes from the company clock, not the server's local
    // time, so it matches the timezone the rest of attendance evaluates in.
    return this.service.overview(userId, requested ?? this.tva.companyToday().slice(0, 7));
  }

  /** One day in full detail, for the day drawer. */
  @Get(':date')
  @ApiOperation({ summary: "One day of the authenticated employee's own attendance" })
  async day(@CurrentUser() user: any, @Param('date') date: string) {
    const userId = user?.id ?? user?.sub;

    if (!DATE_RE.test(date)) {
      throw new BadRequestException('date must be a yyyy-MM-dd value');
    }
    // A syntactically valid but non-existent date (2026-02-31) would otherwise
    // reach the evaluator and be silently normalised by Date.
    if (new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('date is not a real calendar date');
    }

    return this.service.day(userId, date);
  }
}
