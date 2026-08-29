import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { AttendanceExceptionService } from './attendance-exception.service';

/**
 * Attendance Exception Queue API (EQ-1).
 *
 * Both routes are GETs, and there is no third. The queue deliberately owns no
 * write: resolving an exception means calling the service that already owns
 * that decision — regularization approval, manual recovery, console finalize —
 * so there is exactly one way to change attendance and it is the audited one.
 *
 * Scope is resolved from the actor inside the service. There is no userId
 * parameter that widens anything: the filters below can only narrow a set the
 * server already decided this person may see.
 */
@ApiTags('Attendance Exceptions')
@Controller('attendance/exceptions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AttendanceExceptionController {
  constructor(private readonly exceptions: AttendanceExceptionService) {}

  @Get()
  @ApiOperation({ summary: 'Attendance exceptions derived from the official records' })
  list(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
    @Query('state') state?: string,
    @Query('userId') userId?: string,
    @Query('department') department?: string,
  ) {
    return this.exceptions.list(user, { from, to, category, state, userId, department });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Exception counts for the compact strip' })
  summary(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.exceptions.summary(user, { from, to });
  }
}
