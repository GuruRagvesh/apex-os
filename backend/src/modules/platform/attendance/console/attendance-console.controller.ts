import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { AttendanceConsoleService } from './attendance-console.service';
import { PunchReviewService } from './punch-review.service';
import { UnreportedAbsenceService } from '../absence/unreported-absence.service';
import { MonthlyAttendanceReportService, type ExportFile } from './export/monthly-attendance-report.service';

/**
 * A filename safe to put inside a Content-Disposition header: the server builds
 * it from the month label, and anything outside this set is dropped rather than
 * trusted, so no header can be split or spoofed through it.
 */
function sendFile(res: Response, file: ExportFile) {
  const filename = file.filename.replace(/[^A-Za-z0-9._-]/g, '_');
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(file.buffer.length));
  // Attendance data: never cached by a proxy or the browser.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.buffer);
}

/**
 * HR / manager attendance console API (HC-1).
 *
 * Every GET is read-only: none of them can evaluate, persist or finalize.
 * Writing is confined to the POST commands below, which are HR/Admin-gated
 * inside the service using the same isHR/Admin convention the rest of the
 * attendance stack uses.
 *
 * Scope is resolved server-side per request. A manager's calls are narrowed to
 * their own reporting hierarchy before any row is read, so no client-supplied
 * filter can widen what they see.
 */
@ApiTags('Attendance Console')
@Controller('attendance/console')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AttendanceConsoleController {
  constructor(
    private readonly console: AttendanceConsoleService,
    private readonly punchReviews_: PunchReviewService,
    private readonly unreported: UnreportedAbsenceService,
    private readonly monthlyReport: MonthlyAttendanceReportService,
  ) {}

  /** Whether this user sees a team view, a company view, or nothing. */
  @Get('access')
  access(@CurrentUser() user: any) {
    return this.console.canOperate(user);
  }

  @Get('summary')
  summary(@CurrentUser() user: any, @Query('businessDate') businessDate?: string) {
    return this.console.todaySummary(user, businessDate);
  }

  @Get('roster')
  roster(
    @CurrentUser() user: any,
    @Query('businessDate') businessDate?: string,
    @Query('departmentId') departmentId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('evaluationState') evaluationState?: string,
    @Query('exception') exception?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.console.roster(user, {
      businessDate,
      departmentId,
      employeeId,
      status,
      evaluationState,
      exception,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('review-queue')
  reviewQueue(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.console.reviewQueue(user, { from, to, limit: limit ? Number(limit) : undefined });
  }

  /**
   * The on-screen Monthly Register. Built by the same report service, from the
   * same snapshot and assembler, as export.xlsx and export.zip.
   */
  @Get('register')
  register(
    @CurrentUser() user: any,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.monthlyReport.register(user, { month, from, to, departmentId });
  }

  /**
   * The monthly attendance report as a file.
   *
   * Two routes, one report: the workbook (Daily Attendance + Monthly Summary)
   * and the CSV package (the same two tables as two CSV files in one ZIP) are
   * encodings of ONE canonical report built from one database snapshot.
   * Nothing here decides what a number is.
   *
   * Fetched with the Bearer token attached rather than opened as a link, so the
   * bytes are returned to the caller instead of being served to an anonymous
   * browser navigation. Scope is resolved server-side: a department filter can
   * only narrow it, and an ineligible caller gets a 403.
   */
  @Get('register/export.xlsx')
  async exportRegisterXlsx(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    sendFile(res, await this.monthlyReport.export(user, { month, from, to, departmentId }, 'xlsx'));
  }

  @Get('register/export.zip')
  async exportRegisterZip(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    sendFile(res, await this.monthlyReport.export(user, { month, from, to, departmentId }, 'zip'));
  }

  /**
   * The seven-column register as one CSV. Legacy: the console now downloads
   * the CSV package above; kept so an existing integration does not break.
   */
  @Get('register/export.csv')
  async exportRegisterCsv(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    sendFile(res, await this.monthlyReport.exportLegacyRegisterCsv(user, { from, to, departmentId }));
  }

  /**
   * One employee's days in the register month: status, punch times, hours and
   * punch-in / punch-out locations, from the same report as the downloads.
   */
  @Get('register/employee/:userId')
  employeeDays(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.monthlyReport.employeeDays(user, { month, from, to, userId });
  }

  /** Device evidence for the period, HR/Admin only (Phase 3). */
  @Get('register/devices.csv')
  async exportDevicesCsv(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    sendFile(res, await this.monthlyReport.exportDevices(user, { from, to, departmentId }));
  }

  @Get('detail/:userId/:businessDate')
  detail(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Param('businessDate') businessDate: string,
  ) {
    return this.console.dayDetail(user, userId, businessDate);
  }

  /**
   * Explicit attendance evaluation. HR/Admin only.
   *
   * The single body shape covers one employee-date, a whole date, and a bounded
   * range, so there is one command and one code path rather than three that
   * could drift apart. The later scheduler calls the same service.
   */
  @Post('evaluate')
  evaluate(
    @CurrentUser() user: any,
    @Body()
    body: {
      employeeId?: string;
      departmentId?: string;
      businessDate?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    return this.console.runEvaluation(user, body ?? {});
  }

  /** Explicit finalization of one employee-date. HR/Admin only. */
  @Post('finalize')
  finalize(
    @CurrentUser() user: any,
    @Body() body: { userId: string; businessDate: string },
  ) {
    return this.console.finalize(user, body?.userId, body?.businessDate);
  }

  /** HR punch-evidence review queue (Phase 3). HR/Admin only. */
  @Get('punch-reviews')
  punchReviews(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('reason') reason?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.punchReviews_.list(user, { status, reason, from, to, limit: limit ? Number(limit) : undefined });
  }

  @Post('punch-reviews/:id/resolve')
  resolvePunchReview(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { status?: string; note?: string },
  ) {
    return this.punchReviews_.resolve(user, id, body ?? {});
  }

  /** Three-day unreported-absence decisions (Phase 3). HR/Admin only. */
  @Get('unreported-absence')
  unreportedAbsence(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('outcome') outcome?: string,
  ) {
    return this.unreported.list(user, { from, to, outcome });
  }

  @Post('unreported-absence/:id/correct')
  correctUnreportedAbsence(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.unreported.correct(user, id, body ?? {});
  }

  /** HR records that an employee did report an absence (stops the 3-day rule). */
  @Post('absence-reports')
  recordAbsenceReport(
    @CurrentUser() user: any,
    @Body() body: { userId?: string; businessDate?: string; channel?: string; note?: string },
  ) {
    return this.unreported.recordAbsenceReport(user, body ?? {});
  }
}
