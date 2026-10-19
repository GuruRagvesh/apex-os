import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { MeetingV2Service, StartMeetingInput } from './meeting-v2.service';

/** Meeting v2: plan → start → invite → join or decline → leave → approve. */
@ApiTags('Workday')
@Controller('workday/meetings/v2')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MeetingV2Controller {
  constructor(private readonly meetings: MeetingV2Service) {}

  private uid(req: any): string {
    return req.user.id ?? req.user.sub;
  }

  @Get('options')
  options(@Request() req: any) {
    return this.meetings.options(this.uid(req));
  }

  @Post('start')
  start(@Request() req: any, @Body() body: StartMeetingInput) {
    return this.meetings.start(this.uid(req), body);
  }

  @Get('active')
  active(@Request() req: any) {
    return this.meetings.active(this.uid(req));
  }

  @Get('invites')
  invites(@Request() req: any) {
    return this.meetings.invites(this.uid(req));
  }

  @Get('approvals')
  approvals(@Request() req: any) {
    return this.meetings.approvals(this.uid(req));
  }

  @Post(':id/respond')
  respond(@Request() req: any, @Param('id') id: string, @Body() body: { accept?: boolean }) {
    return this.meetings.respond(this.uid(req), id, body?.accept === true);
  }

  @Post(':id/leave')
  leave(@Request() req: any, @Param('id') id: string) {
    return this.meetings.leave(this.uid(req), id);
  }

  @Post(':id/cancel')
  cancel(@Request() req: any, @Param('id') id: string) {
    return this.meetings.cancel(this.uid(req), id);
  }

  @Post(':id/decide')
  decide(@Request() req: any, @Param('id') id: string, @Body() body: { approve?: boolean }) {
    return this.meetings.decide(this.uid(req), id, body?.approve === true);
  }
}
