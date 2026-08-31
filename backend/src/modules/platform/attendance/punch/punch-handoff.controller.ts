import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PunchType } from '@prisma/client';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../../shared/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { PunchHandoffService } from './punch-handoff.service';

/**
 * Phone handoff for a punch the laptop cannot evidence.
 *
 * THE DESKTOP ROUTES need a session: creating, polling and cancelling a handoff
 * are things only the employee at their own machine may do.
 *
 * THE PHONE ROUTE does not. It is authorised by the one-time token in the QR
 * fragment, so an employee in a doorway is not sent through a login screen to
 * finish a punch their laptop already authorised. The token is single-use,
 * expires in minutes, stored only as a hash, and carries the employee and the
 * punch type itself. A session that IS present and belongs to a DIFFERENT
 * employee is refused -- that is the difference between somebody signed out and
 * somebody holding a QR that is not theirs.
 *
 * The raw token arrives in the request BODY, never in the path. It travels to
 * the phone in the URL fragment, which browsers do not send to servers, so it
 * stays out of access logs, proxy logs and Referer headers.
 */
@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance/punch-handoff')
export class PunchHandoffController {
  constructor(private readonly handoff: PunchHandoffService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Validate a handoff for the phone, without changing it' })
  async view(
    @CurrentUser() user: any,
    @Param('handoffId') handoffId: string,
    @Body() body: { token: string },
  ) {
    // Null when the phone has no Apex OS session. That is allowed: the token
    // authorises this. A session for a different employee is refused inside.
    return this.handoff.view(handoffId, body?.token, user?.id ?? user?.sub ?? null);
  }

  @Get(':handoffId/status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Desktop polling fallback for handoff completion' })
  async status(@CurrentUser() user: any, @Param('handoffId') handoffId: string) {
    return this.handoff.status(handoffId, user?.id ?? user?.sub);
  }

  @Delete(':handoffId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel a handoff when the desktop dialog closes' })
  async cancel(@CurrentUser() user: any, @Param('handoffId') handoffId: string) {
    await this.handoff.cancel(handoffId, user?.id ?? user?.sub);
    return { cancelled: true };
  }
}
