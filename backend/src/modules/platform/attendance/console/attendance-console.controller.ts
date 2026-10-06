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
  constructor(private readonly console: AttendanceConsoleService) {}

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

  @Get('register')
  register(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.console.monthlyRegister(user, { from, to, departmentId });
  }

  /**
   * The register as a file.
   *
   * Two routes, one report: both hand the same computed result to a different
   * encoder. Nothing here decides what a number is.
   *
   * Fetched with the Bearer token attached rather than opened as a link, so the
   * bytes are returned to the caller instead of being served to an anonymous
   * browser navigation.
   */
  @Get('register/export.xlsx')
  async exportRegisterXlsx(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    const file = await this.console.exportRegister(user, { from, to, departmentId }, 'xlsx');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @Get('register/export.csv')
  async exportRegisterCsv(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    const file = await this.console.exportRegister(user, { from, to, departmentId }, 'csv');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
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
}
