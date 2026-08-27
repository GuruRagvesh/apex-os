import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { AttendanceActivityService } from './attendance-activity.service';

/**
 * The employee's own attendance provenance.
 *
 * Read-only, and scoped to the caller by construction: there is no userId
 * parameter, so no route here can be pointed at somebody else. HR and
 * leadership keep using the broader /events tooling, which is unchanged.
 */
@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('attendance/me')
export class AttendanceActivityController {
  constructor(private readonly activity: AttendanceActivityService) {}

  @Get('activity')
  @ApiOperation({ summary: "Activity on the authenticated employee's own attendance" })
  async mine(@CurrentUser() user: any, @Query('businessDate') businessDate?: string) {
    const userId = user?.id ?? user?.sub;
    // A malformed date must not silently widen the query to every date.
    const date = businessDate && /^\d{4}-\d{2}-\d{2}$/.test(businessDate) ? businessDate : undefined;
    return this.activity.mine(userId, date);
  }
}
