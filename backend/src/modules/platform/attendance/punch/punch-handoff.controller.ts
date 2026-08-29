import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PunchType } from '@prisma/client';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { PunchHandoffService } from './punch-handoff.service';

/**
 * Phone handoff for a punch the laptop cannot evidence.
 *
 * EVERY route is behind JwtAuthGuard, including the ones the phone calls. The
 * token identifies the punch; the session identifies the person. A QR that
 * worked without a session would be a credential anyone could photograph.
 *
 * The raw token arrives in the request BODY, never in the path. It travels to
 * the phone in the URL fragment, which browsers do not send to servers, so it
 * stays out of access logs, proxy logs and Referer headers.
 */
@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('attendance/punch-handoff')
export class PunchHandoffController {
  constructor(private readonly handoff: PunchHandoffService) {}

  @Post()
  @ApiOperation({ summary: 'Open a one-time phone handoff for a punch' })
  async create(@CurrentUser() user: any, @Body() body: { intent: PunchType }) {
    const created = await this.handoff.create(user?.id ?? user?.sub, body?.intent);

    // The idempotency key is NOT returned: the desktop never submits under it,
    // and the phone reads it server-side from the row it claims.
    return {
      handoffId: created.handoffId,
      token: created.token,
      intent: created.intent,
      expiresAt: created.expiresAt,
    };
  }

  /** Non-mutating. Opening the QR page must not consume or advance anything. */
  @Post(':handoffId/view')
  @ApiOperation({ summary: 'Validate a handoff for the phone, without changing it' })
  async view(
    @CurrentUser() user: any,
    @Param('handoffId') handoffId: string,
    @Body() body: { token: string },
  ) {
    return this.handoff.view(handoffId, body?.token, user?.id ?? user?.sub);
  }

  @Get(':handoffId/status')
  @ApiOperation({ summary: 'Desktop polling fallback for handoff completion' })
  async status(@CurrentUser() user: any, @Param('handoffId') handoffId: string) {
    return this.handoff.status(handoffId, user?.id ?? user?.sub);
  }

  @Delete(':handoffId')
  @ApiOperation({ summary: 'Cancel a handoff when the desktop dialog closes' })
  async cancel(@CurrentUser() user: any, @Param('handoffId') handoffId: string) {
    await this.handoff.cancel(handoffId, user?.id ?? user?.sub);
    return { cancelled: true };
  }
}
