import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { PayrollReportService } from './payroll-report.service';

/**
 * Monthly attendance for payroll. HR and admin only, enforced in the service.
 *
 * There is no route that sends on a schedule and none that accepts a count, a
 * hash or an employee total from the caller. Every figure that justifies a
 * payroll run is derived server-side from the attendance data itself.
 */
@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('attendance/payroll')
export class PayrollReportController {
  constructor(private readonly reports: PayrollReportService) {}

  @Get('preview')
  @ApiOperation({ summary: 'Monthly attendance summary and unresolved counts' })
  async preview(@CurrentUser() user: any, @Query('month') month: string) {
    return this.reports.preview(user, month);
  }

  @Get('download')
  @ApiOperation({ summary: 'Download the monthly attendance workbook' })
  async download(@CurrentUser() user: any, @Query('month') month: string, @Res() res: Response) {
    const { buffer, filename } = await this.reports.download(user, month);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('status/:month')
  @ApiOperation({ summary: 'Month close state' })
  async status(@CurrentUser() user: any, @Param('month') month: string) {
    return this.reports.status(user, month);
  }

  @Post('finalize')
  @ApiOperation({ summary: 'HR accepts the month as the payroll input' })
  async finalize(@CurrentUser() user: any, @Body() body: { month: string }) {
    return this.reports.finalize(user, body?.month);
  }

  /** Explicit. Nothing sends because a calendar month ended. */
  @Post('send')
  @ApiOperation({ summary: 'Send the finalized report to the configured Finance recipient' })
  async send(@CurrentUser() user: any, @Body() body: { month: string }) {
    return this.reports.send(user, body?.month);
  }

  @Get('recipient')
  @ApiOperation({ summary: 'The configured Finance recipients' })
  async recipient(@CurrentUser() user: any) {
    // HR-gated through the same policy as everything else here; the addresses
    // are company configuration, not personal data.
    await this.reports.status(user, this.currentMonth());
    return { recipients: await this.reports.recipients() };
  }

  @Post('recipient')
  @ApiOperation({ summary: 'Set the Finance recipients' })
  async setRecipient(@CurrentUser() user: any, @Body() body: { to: string; cc?: string[] }) {
    return this.reports.setRecipients(user, body);
  }

  private currentMonth(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
