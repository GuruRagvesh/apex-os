import { Controller, Post, Get, Body, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { WorkdayService } from './workday.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';

@ApiTags('Workday')
@Controller('workday')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WorkdayController {
  constructor(private readonly workdayService: WorkdayService) {}

  @Post('start')
  startWork(@Request() req: any) {
    return this.workdayService.startWork(req.user.id ?? req.user.sub);
  }

  @Post('end')
  endWork(@Request() req: any) {
    return this.workdayService.endWork(req.user.id ?? req.user.sub);
  }

  @Post('break/start')
  startBreak(@Request() req: any, @Body() dto: { breakType: string; estimatedMinutes?: number }) {
    return this.workdayService.startBreak(req.user.id ?? req.user.sub, dto);
  }

  @Post('break/end')
  endBreak(@Request() req: any) {
    return this.workdayService.endBreak(req.user.id ?? req.user.sub);
  }

  @Post('idle')
  reportIdle(@Request() req: any, @Body() dto: { idleDuration: number }) {
    return this.workdayService.reportIdle(req.user.id ?? req.user.sub, dto.idleDuration);
  }

  @Post('resume')
  resumeWork(@Request() req: any) {
    return this.workdayService.resumeWork(req.user.id ?? req.user.sub);
  }

  @Get('today')
  getToday(@Request() req: any) {
    return this.workdayService.getToday(req.user.id ?? req.user.sub);
  }

  @Get('team')
  getTeam(@Request() req: any) {
    return this.workdayService.getTeam(req.user);
  }
}
