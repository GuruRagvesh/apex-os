import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { EventLoggerService } from '../../../common/services/event-logger.service';

const ACTION_DESCRIPTIONS: Record<string, string> = {
  TICKET_CREATED: 'created a ticket',
  TICKET_ASSIGNED: 'was assigned a ticket',
  TICKET_STARTED: 'started working on a ticket',
  TICKET_SUBMITTED_FOR_REVIEW: 'submitted ticket for review',
  TICKET_REVIEWED: 'reviewed a ticket',
  TICKET_DONE: 'completed a ticket',
  TICKET_OVERDUE: 'ticket became overdue',
  TICKET_BLOCKED: 'ticket was blocked',
  TICKET_CANCELLED: 'cancelled a ticket',
  TICKET_DELETED: 'deleted a ticket',
  WORKDAY_STARTED: 'started their workday',
  BREAK_STARTED: 'started a break',
  BREAK_ENDED: 'ended break',
  WORKDAY_ENDED: 'ended their workday',
  IDLE_DETECTED: 'was detected as idle',
  IDLE_CLASSIFIED: 'classified idle time',
  LEAVE_REQUESTED: 'requested leave',
  LEAVE_APPROVED: 'approved a leave request',
  LEAVE_REJECTED: 'rejected a leave request',
  USER_LOGIN: 'signed in',
  USER_LOGOUT: 'signed out',
  USER_AUTO_LOGOUT: 'was auto-logged out',
  PROFILE_UPDATED: 'updated their profile',
};

function getEntityUrl(entityType: string, entityId: string, metadata?: any): string | null {
  switch (entityType) {
    case 'Ticket': return `/tickets/${entityId}`;
    case 'LeaveRequest': return `/leave`;
    case 'WorkdaySession': return `/workday`;
    default: return null;
  }
}

function enrichEvent(event: any): any {
  const actionKey = event.action as string;
  const description = ACTION_DESCRIPTIONS[actionKey] ?? actionKey.toLowerCase().replace(/_/g, ' ');
  const entityUrl = getEntityUrl(event.entityType, event.entityId, event.metadata);

  const now = Date.now();
  const ts = new Date(event.timestamp).getTime();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  let timeAgo: string;
  if (diffMin < 1) timeAgo = 'just now';
  else if (diffMin < 60) timeAgo = `${diffMin}m ago`;
  else if (diffMin < 1440) timeAgo = `${Math.floor(diffMin / 60)}h ago`;
  else timeAgo = `${Math.floor(diffMin / 1440)}d ago`;

  return { ...event, description, entityUrl, timeAgo };
}

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

    const events = await this.eventLogger.getCompanyActivity(filters);
    return events.map(enrichEvent);
  }
}
