import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { AttendanceReportService } from './attendance-report.service';
import {
  attendanceWorkbookFilename,
  buildAttendanceWorkbook,
  workbookToBuffer,
} from './attendance-workbook';

/**
 * The attendance report: one dataset, one download.
 *
 * Both routes call the SAME service method, so the console and the spreadsheet
 * cannot disagree about a figure. This replaces three console register routes
 * (`register`, `register/export.xlsx`, `register/export.csv`) which computed a
 * summary-only report through a second, independent stack.
 *
 * Authorization is enforced in the service, not here, so it cannot be bypassed
 * by reaching the service another way.
 */
@ApiTags('Attendance Report')
@Controller('attendance/report')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AttendanceReportController {
  constructor(private readonly report: AttendanceReportService) {}

  /**
   * The canonical dataset the console renders: daily rows, summary rows and the
   * month's metadata.
   */
  @Get(':month')
  async month(@CurrentUser() user: any, @Param('month') month: string) {
    const report = await this.report.monthReport(user, month);
    return {
      month: report.month,
      dailyRows: report.dailyRows,
      summaryRows: report.summaryRows,
      metadata: report.metadata,
    };
  }

  /**
   * The same dataset as a two-sheet workbook.
   *
   * Fetched with the Bearer token attached rather than opened as a link, so the
   * bytes are returned to the caller instead of being served to an anonymous
   * browser navigation.
   *
   * The frontend does NOT build the spreadsheet. It asks for this.
   */
  @Get(':month/download')
  async download(
    @CurrentUser() user: any,
    @Param('month') month: string,
    @Res() res: Response,
  ) {
    const report = await this.report.monthReport(user, month);
    const buffer = await workbookToBuffer(buildAttendanceWorkbook(report));

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${attendanceWorkbookFilename(month)}"`,
    );
    res.send(buffer);
  }
}
