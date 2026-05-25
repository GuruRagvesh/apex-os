import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { EventLoggerService } from '../../../common/services/event-logger.service';

@ApiTags('Events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private eventLogger: EventLoggerService) {}

  @Get()
  async getEvents(
    @Query() query: any,
    @CurrentUser() user: any,
  ) {
    const role: string = user?.role?.name ?? user?.role ?? '';
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(role);

    // Non-admins can only see their own events
    const actorId = isAdmin && query.userId ? query.userId : user.id;

    const filters = {
      actorId,
      entityType: query.entityType,
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit ? Math.min(parseInt(query.limit), 500) : 100,
    };

    return this.eventLogger.getCompanyActivity(filters);
  }
}
