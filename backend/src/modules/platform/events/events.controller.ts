import { Controller, Get, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { EventLoggerService } from '../../../common/services/event-logger.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { PrismaService } from '../../../prisma/prisma.service';

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
  TICKET_REOPENED: 'reopened a ticket',
  TICKET_CLOSED: 'closed a ticket',
  TICKET_UPDATED: 'updated a ticket',
  COMMENT_ADDED: 'added a comment',
  ATTACHMENT_UPLOADED: 'uploaded an attachment',
  PROJECT_CREATED: 'created a project',
  PROJECT_UPDATED: 'updated a project',
  PROJECT_MEMBER_ADDED: 'added a project member',
  PROJECT_MEMBER_REMOVED: 'removed a project member',
  PROJECT_DELETED: 'deleted a project',
  WORKDAY_STARTED: 'started their workday',
  BREAK_STARTED: 'started a break',
  BREAK_ENDED: 'ended break',
  WORKDAY_ENDED: 'ended their workday',
  IDLE_DETECTED: 'was detected as idle',
  IDLE_CLASSIFIED: 'classified idle time',
  LEAVE_REQUESTED: 'requested leave',
  LEAVE_APPROVED: 'approved a leave request',
  LEAVE_REJECTED: 'rejected a leave request',
  LEAVE_CANCELLED: 'cancelled a leave request',
  USER_LOGIN: 'signed in',
  USER_LOGOUT: 'signed out',
  USER_AUTO_LOGOUT: 'was auto-logged out',
  PROFILE_UPDATED: 'updated their profile',
  SETTINGS_UPDATED: 'updated settings',
  USER_CREATED: 'created a user',
  USER_ROLE_CHANGED: 'changed a user role',
  EXPORT_PERFORMED: 'exported data',
};

function getEntityUrl(entityType: string, entityId: string, metadata?: any): string | null {
  switch (entityType) {
    case 'Ticket': return `/tickets/${entityId}`;
    case 'LeaveRequest': return `/leave`;
    case 'Project': return `/projects/${entityId}`;
    // WorkdaySession events link to dashboard (where WorkdayBar lives) — no standalone /workday page
    case 'WorkdaySession': return null;
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

function clip(s: string | null | undefined, max = 45): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

@ApiTags('Events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(
    private eventLogger: EventLoggerService,
    private accessPolicy: AccessPolicyService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async getEvents(
    @Query() query: any,
    @CurrentUser() user: any,
  ) {
    const roleName = this.accessPolicy.roleName(user);
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);

    const where: any = {};
    if (query.entityType) where.entityType = query.entityType;
    if (query.action) where.action = query.action;
    if (query.from || query.to) {
      where.timestamp = {};
      if (query.from) where.timestamp.gte = new Date(query.from);
      if (query.to) where.timestamp.lte = new Date(query.to);
    }

    if (isAdmin) {
      if (query.userId) {
        where.actorId = query.userId;
      }
    } else if (['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
      if (query.userId) {
        const targetUser = await this.prisma.user.findUnique({ where: { id: query.userId } });
        if (!targetUser) return [];
        const canView = await this.accessPolicy.canViewUser(user, targetUser);
        if (!canView) {
          throw new ForbiddenException("You do not have permission to view this user's activity log");
        }
        where.actorId = query.userId;
      } else {
        const deptIds = await this.accessPolicy.managedDepartmentIds(user);
        const members = await this.prisma.user.findMany({
          where: { departmentId: { in: deptIds }, isActive: true },
          select: { id: true },
        });
        const memberIds = members.map((m) => m.id);
        const allAllowedIds = Array.from(new Set([user.id, ...memberIds]));

        // Fetch accessible ticket IDs
        const tickets = await this.prisma.ticket.findMany({
          where: {
            OR: [
              { departmentId: { in: deptIds } },
              { assignedTo: { departmentId: { in: deptIds } } },
              { createdBy: { departmentId: { in: deptIds } } },
              { assignees: { some: { user: { departmentId: { in: deptIds } } } } }
            ]
          },
          select: { id: true }
        });
        const ticketIds = tickets.map((t) => t.id);

        // Fetch accessible leave request IDs
        const leaves = await this.prisma.leaveRequest.findMany({
          where: {
            user: { departmentId: { in: deptIds } }
          },
          select: { id: true }
        });
        const leaveIds = leaves.map((l) => l.id);

        // Fetch accessible project IDs
        const projects = await this.prisma.project.findMany({
          where: {
            OR: [
              { departmentId: { in: deptIds } },
              { members: { some: { user: { departmentId: { in: deptIds } } } } }
            ]
          },
          select: { id: true }
        });
        const projectIds = projects.map((p) => p.id);

        where.OR = [
          { actorId: { in: allAllowedIds } },
          { AND: [ { entityType: 'Ticket' }, { entityId: { in: ticketIds } } ] },
          { AND: [ { entityType: 'LeaveRequest' }, { entityId: { in: leaveIds } } ] },
          { AND: [ { entityType: 'Project' }, { entityId: { in: projectIds } } ] },
        ];
      }
    } else {
      if (query.userId && query.userId !== user.id) {
        throw new ForbiddenException("You do not have permission to view another user's activity log");
      }
      
      // Fetch employee's accessible ticket IDs
      const tickets = await this.prisma.ticket.findMany({
        where: {
          OR: [
            { assignedToId: user.id },
            { createdById: user.id },
            { assignees: { some: { userId: user.id } } }
          ]
        },
        select: { id: true }
      });
      const ticketIds = tickets.map((t) => t.id);

      // Fetch employee's projects
      const projects = await this.prisma.project.findMany({
        where: {
          members: { some: { userId: user.id } }
        },
        select: { id: true }
      });
      const projectIds = projects.map((p) => p.id);

      // Fetch employee's leaves
      const leaves = await this.prisma.leaveRequest.findMany({
        where: { userId: user.id },
        select: { id: true }
      });
      const leaveIds = leaves.map((l) => l.id);

      where.OR = [
        { actorId: user.id },
        { AND: [ { entityType: 'Ticket' }, { entityId: { in: ticketIds } } ] },
        { AND: [ { entityType: 'LeaveRequest' }, { entityId: { in: leaveIds } } ] },
        { AND: [ { entityType: 'Project' }, { entityId: { in: projectIds } } ] },
      ];
    }

    const limit = query.limit ? Math.min(parseInt(query.limit), 500) : 100;
    const events = await this.prisma.operationalEvent.findMany({
      where,
      include: { actor: { select: { id: true, name: true, avatar: true } } },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    const enriched = events.map(enrichEvent);
    return this.enrichWithTitles(enriched);
  }

  // ── Batch-enrich events with entity names (avoids N+1) ───────────────────
  private async enrichWithTitles(events: any[]): Promise<any[]> {
    const ticketIds = [...new Set(
      events.filter((e) => e.entityType === 'Ticket' && e.entityId).map((e) => e.entityId as string),
    )];
    const projectIds = [...new Set(
      events.filter((e) => e.entityType === 'Project' && e.entityId).map((e) => e.entityId as string),
    )];

    const [tickets, projects] = await Promise.all([
      ticketIds.length > 0
        ? this.prisma.ticket.findMany({
            where: { id: { in: ticketIds } },
            select: { id: true, ticketId: true, title: true },
          })
        : [],
      projectIds.length > 0
        ? this.prisma.project.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const ticketMap = new Map<string, { id: string; ticketId: string; title: string }>();
    for (const t of tickets) ticketMap.set(t.id, t);
    const projectMap = new Map<string, { id: string; name: string }>();
    for (const p of projects) projectMap.set(p.id, p);

    return events.map((event) => {
      let { description } = event;
      let metadata = event.metadata ?? {};

      if (event.entityType === 'Ticket') {
        const ticket = ticketMap.get(event.entityId);
        if (ticket) {
          const title = clip(ticket.title);
          const tid = ticket.ticketId;
          switch (event.action) {
            case 'TICKET_CREATED':              description = `created '${title}'`; break;
            case 'TICKET_STARTED':              description = `started working on '${title}'`; break;
            case 'TICKET_SUBMITTED_FOR_REVIEW': description = `submitted '${title}' for review`; break;
            case 'TICKET_DONE':                 description = `completed '${title}'`; break;
            case 'TICKET_ASSIGNED':             description = `was assigned '${title}'`; break;
            case 'TICKET_REVIEWED':             description = `reviewed '${title}'`; break;
            case 'TICKET_REOPENED':             description = `reopened '${title}'`; break;
            case 'TICKET_CANCELLED':            description = `cancelled '${title}'`; break;
            case 'TICKET_BLOCKED':              description = `blocked '${title}'`; break;
            case 'TICKET_CLOSED':               description = `closed '${title}'`; break;
            case 'TICKET_UPDATED':              description = `updated '${title}'`; break;
            case 'TICKET_DELETED':              description = `deleted ticket ${tid}`; break;
            case 'COMMENT_ADDED':               description = `commented on '${title}'`; break;
            case 'ATTACHMENT_UPLOADED':         description = `uploaded file to '${title}'`; break;
          }
          // Ensure ticketId is in metadata so frontend can show the badge
          if (!metadata.ticketId) metadata = { ...metadata, ticketId: tid };
        }
      }

      if (event.entityType === 'Project') {
        const project = projectMap.get(event.entityId);
        if (project) {
          const name = clip(project.name);
          switch (event.action) {
            case 'PROJECT_CREATED':        description = `created project '${name}'`; break;
            case 'PROJECT_UPDATED':        description = `updated project '${name}'`; break;
            case 'PROJECT_MEMBER_ADDED':   description = `added a member to '${name}'`; break;
            case 'PROJECT_MEMBER_REMOVED': description = `removed a member from '${name}'`; break;
            case 'PROJECT_DELETED':        description = `deleted project '${name}'`; break;
          }
        }
      }

      return { ...event, description, metadata };
    });
  }
}
