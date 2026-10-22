import { Controller, Get, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { EventLoggerService } from '../../../common/services/event-logger.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TVAService } from '../../../common/services/tva.service';

const ACTION_DESCRIPTIONS: Record<string, string> = {
  TICKET_CREATED: 'created a ticket',
  TICKET_ASSIGNED: 'was assigned a ticket',
  TICKET_STARTED: 'started working on a ticket',
  TICKET_SUBMITTED_FOR_REVIEW: 'submitted ticket for review',
  TICKET_REVIEWED: 'reviewed a ticket',
  TICKET_REVIEW_STARTED: 'started reviewing a ticket',
  TICKET_REVIEW_PAUSED: 'paused reviewing a ticket',
  TICKET_REVIEW_WITHDRAWN: 'withdrew a ticket from review',
  TICKET_DONE: 'completed a ticket',
  TICKET_OVERDUE: 'ticket became overdue',
  TICKET_BLOCKED: 'ticket was blocked',
  TICKET_UNBLOCKED: 'ticket was unblocked',
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

const EVENT_CATEGORIES: Record<string, string[]> = {
  tickets: [
    'TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_UNASSIGNED', 'TICKET_ASSIGNEE_REMOVED',
    'TICKET_UPDATED', 'TICKET_STARTED', 'TICKET_SUBMITTED_FOR_REVIEW', 'TICKET_REVIEWED',
    'TICKET_REVIEW_STARTED', 'TICKET_REVIEW_PAUSED', 'TICKET_REVIEW_WITHDRAWN',
    'TICKET_DONE', 'TICKET_CLOSED', 'TICKET_REOPENED', 'TICKET_OVERDUE', 'TICKET_BLOCKED',
    'TICKET_UNBLOCKED', 'TICKET_CANCELLED', 'TICKET_DELETED', 'TICKET_APPROVED',
    'TICKET_REJECTED', 'COMMENT_ADDED', 'ATTACHMENT_UPLOADED', 'ATTACHMENT_DELETED',
    'DOCUMENT_UPLOADED', 'DOCUMENT_DELETED', 'PHOTO_UPLOADED', 'PHOTO_REMOVED',
  ],
  projects: ['PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_MEMBER_ADDED', 'PROJECT_MEMBER_REMOVED', 'PROJECT_DELETED'],
  attendance: [
    'WORKDAY_STARTED', 'BREAK_STARTED', 'BREAK_ENDED', 'IDLE_DETECTED', 'IDLE_CLASSIFIED',
    'WORKDAY_CONTINUED', 'WORKDAY_ENDED', 'ATTENDANCE_PUNCH_RECORDED',
    'REGULARIZATION_REQUESTED', 'REGULARIZATION_MANAGER_APPROVED', 'REGULARIZATION_HR_APPROVED',
    'REGULARIZATION_REJECTED', 'REGULARIZATION_DECIDED', 'REGULARIZATION_DECISION_STALE',
    'ATTENDANCE_OFFICIAL_REVISED', 'ATTENDANCE_FINALIZED', 'ATTENDANCE_EVALUATION_RUN',
    'ATTENDANCE_SHADOW_RUN', 'ATTENDANCE_CONFIGURATION_ERROR', 'ATTENDANCE_PUNCH_REVIEWED',
    'ATTENDANCE_ABSENCE_REPORTED', 'ATTENDANCE_UNREPORTED_ABSENCE_LWP',
    'ATTENDANCE_UNREPORTED_ABSENCE_CORRECTED', 'COMP_OFF_GRANTED', 'COMP_OFF_CONSUMED',
  ],
  leave: [
    'LEAVE_REQUESTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED',
    'LEAVE_REROUTED', 'LEAVE_EVIDENCE_SUBMITTED', 'LEAVE_FUNDING_CHANGED', 'LEAVE_SETUP_RESOLVED',
  ],
  people: [
    'USER_LOGIN', 'USER_LOGOUT', 'USER_AUTO_LOGOUT', 'USER_CREATED', 'USER_UPDATED',
    'USER_DEACTIVATED', 'USER_REACTIVATED', 'USER_ROLE_CHANGED', 'ADMIN_USER_EMAIL_CORRECTED',
    'PROFILE_UPDATED', 'PERSONAL_INFORMATION_CHANGE_REQUESTED',
    'PERSONAL_INFORMATION_CHANGE_CONFIRMED', 'PERSONAL_INFORMATION_CHANGE_DECLINED',
    'PERSONAL_INFORMATION_CHANGE_APPROVED', 'PERSONAL_INFORMATION_CHANGE_REJECTED',
    'SENSITIVE_DATA_VIEWED', 'SENSITIVE_DATA_EDITED',
  ],
  settings: ['SETTINGS_UPDATED'],
  sales: [
    'LEAD_CREATED', 'LEAD_UPDATED', 'LEAD_OWNER_CHANGED', 'LEAD_STAGE_CHANGED',
    'LEAD_DELETED', 'LEAD_ACTIVITY_ADDED', 'LEAD_FOLLOWUP_ADDED',
    'LEAD_REQUIREMENT_ADDED', 'LEAD_DEAL_ADDED',
  ],
  system: ['EXPORT_PERFORMED'],
};

const CRITICAL_ACTIONS = new Set([
  'TICKET_DELETED', 'PROJECT_DELETED', 'USER_DEACTIVATED', 'ADMIN_USER_EMAIL_CORRECTED',
  'SENSITIVE_DATA_EDITED', 'ATTENDANCE_CONFIGURATION_ERROR', 'LEAD_DELETED',
]);

const WARNING_ACTIONS = new Set([
  'TICKET_OVERDUE', 'TICKET_BLOCKED', 'TICKET_REJECTED', 'TICKET_CANCELLED',
  'ATTACHMENT_DELETED', 'DOCUMENT_DELETED', 'PHOTO_REMOVED', 'IDLE_DETECTED',
  'REGULARIZATION_REJECTED', 'REGULARIZATION_DECISION_STALE',
  'ATTENDANCE_ABSENCE_REPORTED', 'ATTENDANCE_UNREPORTED_ABSENCE_LWP',
  'LEAVE_REJECTED', 'LEAVE_CANCELLED', 'USER_AUTO_LOGOUT',
  'PERSONAL_INFORMATION_CHANGE_DECLINED', 'PERSONAL_INFORMATION_CHANGE_REJECTED',
]);

function categoryForAction(action: string): string {
  return Object.entries(EVENT_CATEGORIES).find(([, actions]) => actions.includes(action))?.[0] ?? 'system';
}

function severityForAction(action: string): 'critical' | 'warning' | 'info' {
  if (CRITICAL_ACTIONS.has(action)) return 'critical';
  if (WARNING_ACTIONS.has(action)) return 'warning';
  return 'info';
}

function actionsForSeverity(severity: string): string[] | null {
  const all = Object.values(EVENT_CATEGORIES).flat();
  if (severity === 'critical') return all.filter((action) => CRITICAL_ACTIONS.has(action));
  if (severity === 'warning') return all.filter((action) => WARNING_ACTIONS.has(action));
  if (severity === 'info') return all.filter((action) => !CRITICAL_ACTIONS.has(action) && !WARNING_ACTIONS.has(action));
  return null;
}

function intersectActions(left: string[] | null, right: string[] | null): string[] | null {
  if (!left) return right;
  if (!right) return left;
  const allowed = new Set(right);
  return left.filter((action) => allowed.has(action));
}

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

function enrichEvent(event: any, nowMs: number): any {
  const actionKey = event.action as string;
  const description = ACTION_DESCRIPTIONS[actionKey] ?? actionKey.toLowerCase().replace(/_/g, ' ');
  const entityUrl = getEntityUrl(event.entityType, event.entityId, event.metadata);

  const ts = new Date(event.timestamp).getTime();
  const diffMs = nowMs - ts;
  const diffMin = Math.floor(diffMs / 60000);
  let timeAgo: string;
  if (diffMin < 1) timeAgo = 'just now';
  else if (diffMin < 60) timeAgo = `${diffMin}m ago`;
  else if (diffMin < 1440) timeAgo = `${Math.floor(diffMin / 60)}h ago`;
  else timeAgo = `${Math.floor(diffMin / 1440)}d ago`;

  return {
    ...event,
    description,
    entityUrl,
    timeAgo,
    category: categoryForAction(actionKey),
    severity: severityForAction(actionKey),
  };
}

function clip(s: string | null | undefined, max = 45): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

@ApiTags('Events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(
    private eventLogger: EventLoggerService,
    private accessPolicy: AccessPolicyService,
    private prisma: PrismaService,
    private tva: TVAService,
  ) {}

  @Get()
  async getEvents(
    @Query() query: any,
    @CurrentUser() user: any,
  ) {
    const roleName = this.accessPolicy.roleName(user);
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);
    const paginated = query.paginated === 'true' || query.page !== undefined;
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(Math.max(Number.parseInt(query.limit ?? (paginated ? '30' : '100'), 10) || 30, 1), paginated ? 100 : 500);

    const where: any = {};
    if (query.entityType) where.entityType = query.entityType;
    let allowedActions: string[] | null = null;
    if (query.category && EVENT_CATEGORIES[query.category]) {
      allowedActions = EVENT_CATEGORIES[query.category];
    }
    allowedActions = intersectActions(allowedActions, actionsForSeverity(query.severity));
    if (query.action) {
      // Exact event type still honours category/severity when those filters are also present.
      where.action = allowedActions && !allowedActions.includes(query.action)
        ? { in: [] }
        : query.action;
    }
    else if (allowedActions) where.action = { in: allowedActions };
    if (query.from || query.to) {
      where.timestamp = {};
      if (query.from && !Number.isNaN(new Date(query.from).getTime())) where.timestamp.gte = new Date(query.from);
      if (query.to && !Number.isNaN(new Date(query.to).getTime())) where.timestamp.lte = new Date(query.to);
    }

    if (isAdmin) {
      if (query.userId) {
        where.actorId = query.userId;
      }
    } else if (['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
      if (query.userId) {
        const targetUser = await this.prisma.user.findUnique({ where: { id: query.userId } });
        if (!targetUser) {
          return paginated
            ? { items: [], total: 0, page, pageSize, totalPages: 0, summary: { byCategory: {}, bySeverity: {}, uniqueActors: 0 } }
            : [];
        }
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

    if (query.departmentId) {
      if (!isAdmin) {
        const allowedDepartmentIds = await this.accessPolicy.managedDepartmentIds(user);
        if (!allowedDepartmentIds.includes(query.departmentId)) {
          throw new ForbiddenException('You do not have permission to view activity for this department');
        }
      }

      const [departmentUsers, departmentTickets, departmentLeaves, departmentProjects] = await Promise.all([
        this.prisma.user.findMany({
          where: { departmentId: query.departmentId },
          select: { id: true },
        }),
        this.prisma.ticket.findMany({
          where: {
            OR: [
              { departmentId: query.departmentId },
              { assignedTo: { departmentId: query.departmentId } },
              { createdBy: { departmentId: query.departmentId } },
              { assignees: { some: { user: { departmentId: query.departmentId } } } },
            ],
          },
          select: { id: true },
        }),
        this.prisma.leaveRequest.findMany({
          where: { user: { departmentId: query.departmentId } },
          select: { id: true },
        }),
        this.prisma.project.findMany({
          where: {
            OR: [
              { departmentId: query.departmentId },
              { members: { some: { user: { departmentId: query.departmentId } } } },
            ],
          },
          select: { id: true },
        }),
      ]);

      const departmentScope = {
        OR: [
          { actorId: { in: departmentUsers.map((item) => item.id) } },
          { AND: [{ entityType: 'Ticket' }, { entityId: { in: departmentTickets.map((item) => item.id) } }] },
          { AND: [{ entityType: 'LeaveRequest' }, { entityId: { in: departmentLeaves.map((item) => item.id) } }] },
          { AND: [{ entityType: 'Project' }, { entityId: { in: departmentProjects.map((item) => item.id) } }] },
        ],
      };
      if (query.userId && !departmentUsers.some((item) => item.id === query.userId)) {
        // A person filter is always subordinate to the selected department.
        where.actorId = { in: [] };
      }
      const roleScope = where.OR ? { OR: where.OR } : null;
      if (where.OR) delete where.OR;
      where.AND = [...(where.AND ?? []), ...(roleScope ? [roleScope] : []), departmentScope];
    }

    // Search is AND-ed with the role scope instead of replacing its OR clause.
    if (query.q?.trim()) {
      const scopedOr = where.OR;
      if (scopedOr) delete where.OR;
      const search = query.q.trim();
      where.AND = [
        ...(where.AND ?? []),
        ...(scopedOr ? [{ OR: scopedOr }] : []),
        {
          OR: [
            { action: { contains: search, mode: 'insensitive' } },
            { entityType: { contains: search, mode: 'insensitive' } },
            { actor: { name: { contains: search, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const [events, total, actionGroups, actorGroups] = await Promise.all([
      this.prisma.operationalEvent.findMany({
        where,
        include: { actor: { select: { id: true, name: true, avatar: true } } },
        orderBy: { timestamp: 'desc' },
        skip: paginated ? (page - 1) * pageSize : 0,
        take: pageSize,
      }),
      paginated ? this.prisma.operationalEvent.count({ where }) : Promise.resolve(0),
      paginated
        ? (this.prisma.operationalEvent as any).groupBy({ by: ['action'], where, _count: { _all: true } })
        : Promise.resolve([]),
      paginated
        ? (this.prisma.operationalEvent as any).groupBy({ by: ['actorId'], where, _count: { _all: true } })
        : Promise.resolve([]),
    ]);
    const nowMs = this.tva.now().getTime();
    const enriched = events.map((e) => enrichEvent(e, nowMs));
    const titled = await this.enrichWithTitles(enriched);
    const items = titled.map((event) => this.sanitizeEvent(event, isAdmin, user.id));

    if (!paginated) return items;

    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const group of actionGroups as any[]) {
      const count = group._count?._all ?? 0;
      const category = categoryForAction(group.action);
      const severity = severityForAction(group.action);
      byCategory[category] = (byCategory[category] ?? 0) + count;
      bySeverity[severity] = (bySeverity[severity] ?? 0) + count;
    }

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      summary: { byCategory, bySeverity, uniqueActors: (actorGroups as any[]).length },
    };
  }

  private sanitizeEvent(event: any, isAdmin: boolean, viewerId: string): any {
    if (isAdmin) return event;
    const { ip: _ip, device: _device, ...safe } = event;
    if (event.actorId !== viewerId && ['SENSITIVE_DATA_VIEWED', 'SENSITIVE_DATA_EDITED', 'ADMIN_USER_EMAIL_CORRECTED'].includes(event.action)) {
      const { beforeValue: _before, afterValue: _after, metadata: _metadata, ...restricted } = safe;
      return restricted;
    }
    return safe;
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
            case 'TICKET_UNBLOCKED':            description = `unblocked '${title}'`; break;
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
