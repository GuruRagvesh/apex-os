import { Controller, Post, Get, Body, Request, UseGuards, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { WorkdayService } from './workday.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { ClassifyMeetingInput, MeetingService } from './meeting.service';
import { ProductivityTimelineService } from './productivity-timeline.service';

function requestAuditContext(req: any, actorContext: string) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return {
    ipAddress: req?.ip || forwardedIp || req?.socket?.remoteAddress,
    userAgent: req?.headers?.['user-agent'],
    actorContext,
  };
}

@ApiTags('Workday')
@Controller('workday')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WorkdayController {
  constructor(
    private readonly workdayService: WorkdayService,
    private readonly meetingService: MeetingService,
    private readonly productivityTimeline: ProductivityTimelineService,
  ) {}

  @Get('productivity-timeline/people')
  productivityTimelinePeople(@Request() req: any) {
    return this.productivityTimeline.people(req.user.id ?? req.user.sub);
  }

  @Get('productivity-timeline')
  productivityTimelineData(@Request() req: any, @Query('userId') userId: string, @Query('month') month: string) {
    return this.productivityTimeline.get(req.user.id ?? req.user.sub, userId, month);
  }

  @Get('meetings/options')
  meetingOptions(@Request() req: any) {
    return this.meetingService.options(req.user.id ?? req.user.sub);
  }

  @Get('meetings')
  meetings(@Request() req: any) {
    return this.meetingService.list(req.user.id ?? req.user.sub);
  }

  @Get('meetings/pending-classification')
  pendingMeetingClassification(@Request() req: any) {
    return this.meetingService.pendingClassification(req.user.id ?? req.user.sub);
  }

  @Get('meetings/lookup/:code')
  lookupMeeting(@Request() req: any, @Param('code') code: string) {
    return this.meetingService.lookup(req.user.id ?? req.user.sub, code);
  }

  @Post('meetings/classify')
  classifyMeeting(@Request() req: any, @Body() dto: ClassifyMeetingInput) {
    return this.meetingService.classify(req.user.id ?? req.user.sub, dto);
  }

  @Post('meetings/start')
  startMeeting(@Request() req: any) {
    return this.workdayService.startBreak(req.user.id ?? req.user.sub, { breakType: 'MEETING' });
  }

  @Get('history/:userId')
  getHistory(@Param('userId') userId: string, @Request() req: any) {
    return this.workdayService.getHistory(userId, req.user);
  }

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
    return this.workdayService.endBreak(
      req.user.id ?? req.user.sub,
      { origin: 'USER_RESUME', ...requestAuditContext(req, 'BREAK_END_ENDPOINT') },
    );
  }

  @Post('idle')
  reportIdle(@Request() req: any, @Body() dto: { idleDuration: number }) {
    return this.workdayService.reportIdle(req.user.id ?? req.user.sub, dto.idleDuration);
  }

  @Post('resume')
  resumeWork(@Request() req: any) {
    return this.workdayService.resumeWork(
      req.user.id ?? req.user.sub,
      requestAuditContext(req, 'WORKDAY_RESUME_ENDPOINT'),
    );
  }

  @Post('resume-auto-closed')
  resumeAutoClosedWork(@Request() req: any) {
    return this.workdayService.resumeAutoClosedWork(req.user.id ?? req.user.sub);
  }

  @Post('continue-working')
  continueWorking(@Request() req: any) {
    return this.workdayService.continueWorking(req.user.id ?? req.user.sub);
  }

  @Get('today')
  getToday(@Request() req: any) {
    return this.workdayService.getToday(req.user.id ?? req.user.sub);
  }

  @Get('team')
  getTeam(@Request() req: any, @Query('date') date?: string) {
    return this.workdayService.getTeam(req.user, date);
  }
}
