import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { HrmsAttendanceService } from './hrms-attendance.service';
import { BreakStartDto, PunchInDto, PunchOutDto } from './dto/hrms-attendance.dto';

@ApiTags('HRMS Attendance')
@Controller('hrms/attendance')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HrmsAttendanceController {
  constructor(private readonly hrmsAttendanceService: HrmsAttendanceService) {}

  private userId(req: any): string {
    return req.user.id ?? req.user.sub;
  }

  private userAgent(req: any): string | undefined {
    return req.headers?.['user-agent'];
  }

  @Get('today')
  getToday(@Request() req: any) {
    return this.hrmsAttendanceService.getToday(this.userId(req));
  }

  @Post('punch-in')
  punchIn(@Request() req: any, @Body() dto: PunchInDto) {
    return this.hrmsAttendanceService.punchIn(this.userId(req), dto, req.ip, this.userAgent(req));
  }

  @Post('break-start')
  breakStart(@Request() req: any, @Body() dto: BreakStartDto) {
    return this.hrmsAttendanceService.breakStart(this.userId(req), dto, this.userAgent(req));
  }

  @Post('break-end')
  breakEnd(@Request() req: any) {
    return this.hrmsAttendanceService.breakEnd(this.userId(req), this.userAgent(req));
  }

  @Post('punch-out')
  punchOut(@Request() req: any, @Body() dto: PunchOutDto) {
    return this.hrmsAttendanceService.punchOut(this.userId(req), dto, this.userAgent(req));
  }

  @Get('history')
  getHistory(@Request() req: any) {
    return this.hrmsAttendanceService.getHistory(this.userId(req), req.user);
  }
}
