import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { EmployeeAttendanceSummaryService } from './employee-attendance-summary.service';

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * The employee Attendance dashboard's one read.
 *
 * Authorization is NOT re-implemented here -- the service's own
 * assertMayView() decides who may see whose summary, reusing the same
 * canViewUser rule GET /users/:id/profile already enforces. This controller
 * only validates the query shape and translates the service's own refusals.
 */
@ApiTags('Attendance')
@Controller('attendance/employee')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EmployeeAttendanceSummaryController {
  constructor(private readonly summaryService: EmployeeAttendanceSummaryService) {}

  private validateMonth(month?: string) {
    if (month !== undefined && !MONTH_RE.test(month)) {
      throw new BadRequestException('month must be yyyy-MM');
    }
  }

  /** My own Attendance summary for a month. Defaults to the current company month. */
  @Get('me/summary')
  @ApiOperation({ summary: 'My Attendance dashboard summary' })
  async mine(@CurrentUser() user: any, @Query('month') month?: string) {
    this.validateMonth(month);
    const userId = user?.id ?? user?.sub;
    return this.summaryService.summary(userId, userId, month);
  }

  /**
   * An employee's Attendance summary, for a viewer with authority to see it.
   * The service refuses with 403/404 when the caller may not.
   */
  @Get(':id/summary')
  @ApiOperation({ summary: 'An employee’s Attendance dashboard summary (manager/HR/admin)' })
  async forEmployee(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('month') month?: string,
  ) {
    this.validateMonth(month);
    const requesterId = user?.id ?? user?.sub;
    return this.summaryService.summary(requesterId, id, month);
  }
}
