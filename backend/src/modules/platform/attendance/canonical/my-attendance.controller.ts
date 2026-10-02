import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { AttendanceReportService } from './attendance-report.service';

/**
 * My Attendance: the employee's own canonical record.
 *
 * SAME DATA HR SEES, SCOPED TO ONE PERSON. These routes call the canonical
 * assembly, not a self-service copy of it, so an employee and the payroll
 * register cannot disagree about the same day. An employee who is told their
 * attendance is wrong needs to be looking at the figure payroll is looking at.
 *
 * NO userId PARAMETER ANYWHERE, deliberately and following the convention the
 * activity route already set: the scope comes from the JWT subject, so there is
 * no cross-employee read for a bug or a crafted request to reach. Adding a
 * userId here later would be adding an authorization problem that currently
 * cannot exist -- a manager or HR view belongs on its own scoped route.
 *
 * READ-ONLY. Nothing here evaluates or persists.
 */
@ApiTags('Attendance')
@Controller('attendance/me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MyAttendanceController {
  constructor(private readonly report: AttendanceReportService) {}

  /**
   * One month: the days, the summary, and the rules the month was read under.
   *
   * `summary` is the KPI row the dashboard renders. It is the SAME nineteen
   * figures the monthly register carries, computed by the same builder -- the
   * dashboard presents them, it does not calculate them. A KPI computed in
   * React would be a second opinion with no way to tell which one payroll used.
   */
  @Get('month/:month')
  @ApiOperation({ summary: "The authenticated employee's own canonical month" })
  async month(@CurrentUser() user: any, @Param('month') month: string) {
    const report = await this.report.myMonth(user, month);

    return {
      month: report.month,
      days: report.dailyRows,
      // At most one row: the assembly was scoped to one employee. null when the
      // employee was not employed during the month at all, which the UI shows
      // as "not employed" rather than as a month of zeros.
      summary: report.summaryRows[0] ?? null,
      metadata: report.metadata,
    };
  }

  /**
   * Twelve monthly summaries for a year.
   *
   * The year view is twelve summary rows, NOT 365 days. A year of days is
   * thousands of rows moved to render twelve numbers, and nothing on the screen
   * would use the rest.
   */
  @Get('year/:year')
  @ApiOperation({ summary: "Twelve monthly summaries for the authenticated employee" })
  async year(@CurrentUser() user: any, @Param('year') year: string) {
    return this.report.myYear(user, year);
  }
}
