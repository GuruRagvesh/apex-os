import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { DailyAttendanceEvaluatorService } from './daily-attendance-evaluator.service';
import { TVAService } from '../../../../common/services/tva.service';
import type { DailyAttendanceResult } from './daily-attendance.types';

/** Longest range one request may ask for. A month view needs ~31. */
const MAX_RANGE_DAYS = 62;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Employee-facing daily attendance API (AE-1).
 *
 * Scoped entirely by the JWT subject: there is no userId parameter, so there is
 * no cross-employee read to get wrong. Manager and HR views arrive with the HR
 * console wave, which needs an authorization model this wave does not define.
 *
 * Both routes are READ-ONLY — they evaluate and return, and never persist. A
 * GET that wrote an official attendance record would make the record depend on
 * who happened to open the page; the scheduler wave owns persistence.
 */
@ApiTags('Attendance')
@Controller('attendance/daily')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DailyAttendanceController {
  constructor(
    private readonly evaluator: DailyAttendanceEvaluatorService,
    private readonly tva: TVAService,
  ) {}

  /** Today's attendance for the authenticated employee. */
  @Get('today')
  async today(@CurrentUser() user: any) {
    const userId = user?.id ?? user?.sub;
    const result = await this.evaluator.evaluate(userId, this.tva.companyToday());
    return toEmployeeView(result);
  }

  /**
   * The authenticated employee's attendance across a date range.
   *
   * Defaults to the current company month when no range is given.
   */
  @Get()
  async range(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const userId = user?.id ?? user?.sub;
    const today = this.tva.companyToday();

    const start = from ?? `${today.slice(0, 7)}-01`;
    const end = to ?? today;

    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      throw new BadRequestException('from and to must be yyyy-MM-dd dates');
    }
    if (start > end) {
      throw new BadRequestException('from must not be after to');
    }

    const dates = enumerateDates(start, end);
    if (dates.length > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Range is limited to ${MAX_RANGE_DAYS} days`);
    }

    // Sequential on purpose. Each evaluation resolves its own context and hits
    // the database several times; firing 62 of those concurrently would be a
    // burst against a small production instance for no user-visible gain.
    const days = [];
    for (const date of dates) {
      days.push(toEmployeeView(await this.evaluator.evaluate(userId, date)));
    }

    return { from: start, to: end, days };
  }
}

/** Inclusive list of yyyy-MM-dd dates, walked in UTC to avoid DST surprises. */
function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * The employee's view of a day.
 *
 * Provenance ids stay server-side: they are for reproducing a decision during a
 * dispute, not for the employee's calendar. Photo storage keys in particular
 * are never exposed — a punch photo is reachable only through the existing
 * short-lived signed-URL route, scoped to its owner.
 */
function toEmployeeView(r: DailyAttendanceResult) {
  return {
    businessDate: r.businessDate,
    official: r.official,
    status: r.status,
    evaluationState: r.evaluationState,
    reason: r.calculationReason,
    exceptions: r.exceptionFlags,
    requiresReview: r.requiresReview,

    punchInAt: r.punchInAt,
    punchOutAt: r.punchOutAt,
    workedMinutes: r.workedMinutes,
    breakMinutes: r.breakMinutes,
    lateMinutes: r.lateMinutes,

    isHoliday: r.status === 'HOLIDAY',
    isWeeklyOff: r.status === 'WEEKLY_OFF',
    isLeave: r.status === 'LEAVE' || r.status === 'LWP' || r.status === 'HALF_DAY',
    leaveDeducted: r.leaveDeducted,
    lwpDeducted: r.lwpDeducted,

    // Presence facts only — no object keys, no hashes.
    locationException: r.exceptionFlags.find((f) => f.startsWith('LOCATION_')) ?? null,
    photoCaptured: !r.exceptionFlags.includes('PHOTO_MISSING'),
  };
}
