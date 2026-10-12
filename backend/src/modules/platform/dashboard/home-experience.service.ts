import { BadRequestException, Injectable } from '@nestjs/common';
import { LeaveStatus, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';
import { TVAService } from '../../../common/services/tva.service';
import { LeaveService } from '../../operations/leave/leave.service';
import { calculateWorkdayRuntime } from '../workday/workday.calculation';

const TERMINAL_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.PENDING_APPROVAL,
  TicketStatus.DONE,
  TicketStatus.CLOSED,
];

@Injectable()
export class HomeExperienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly ticketAccess: TicketAccessService,
    private readonly timing: TicketTimingService,
    private readonly leaveAccess: LeaveAccessService,
    private readonly tva: TVAService,
    private readonly leaveService: LeaveService,
  ) {}

  private andWhere(...clauses: any[]): any {
    const parts = clauses.filter((clause) => clause && Object.keys(clause).length);
    return parts.length > 1 ? { AND: parts } : parts[0] ?? {};
  }

  async getWorkspace(userId: string) {
    const row = await this.prisma.dashboardWorkspace.findUnique({ where: { userId } });
    const today = this.tva.companyToday();
    const checklist = Array.isArray(row?.checklist) ? row.checklist as any[] : [];
    return {
      notes: row?.notes ?? '',
      checklist: checklist.map((item) => ({
        id: item.id, text: item.text, done: item.completedOn === today,
      })),
      shortcuts: row?.shortcuts ?? {},
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async updateWorkspace(userId: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Workspace must be an object');
    }
    const body = input as Record<string, unknown>;
    const allowed = ['notes', 'checklist', 'shortcuts'];
    if (Object.keys(body).some((key) => !allowed.includes(key)) || !Object.keys(body).length) {
      throw new BadRequestException('Unknown or missing workspace fields');
    }
    const data: any = {};
    if ('notes' in body) {
      if (typeof body.notes !== 'string' || body.notes.length > 5000) {
        throw new BadRequestException('Notes must be 5000 characters or fewer');
      }
      data.notes = body.notes;
    }
    if ('checklist' in body) {
      if (!Array.isArray(body.checklist) || body.checklist.length > 30) {
        throw new BadRequestException('Checklist must contain 30 tasks or fewer');
      }
      const ids = new Set<string>();
      data.checklist = body.checklist.map((entry: any) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
            typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id) ||
            typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 160 ||
            typeof entry.done !== 'boolean' || ids.has(entry.id)) {
          throw new BadRequestException('Checklist contains an invalid task');
        }
        ids.add(entry.id);
        return { id: entry.id, text: entry.text.trim(), completedOn: entry.done ? this.tva.companyToday() : null };
      });
    }
    if ('shortcuts' in body) {
      if (!body.shortcuts || typeof body.shortcuts !== 'object' || Array.isArray(body.shortcuts)) {
        throw new BadRequestException('Shortcuts must be an object');
      }
      const shortcuts = body.shortcuts as Record<string, unknown>;
      if (Object.keys(shortcuts).some((key) => !['mail', 'teams', 'drive'].includes(key))) {
        throw new BadRequestException('Only Mail, Teams and Drive shortcuts can be configured');
      }
      for (const value of Object.values(shortcuts)) {
        if (typeof value !== 'string' || value.length > 500 || (value && !/^https:\/\/[^\s]+$/i.test(value))) {
          throw new BadRequestException('Shortcut URLs must use HTTPS');
        }
      }
      data.shortcuts = shortcuts;
    }
    await this.prisma.dashboardWorkspace.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.getWorkspace(userId);
  }

  /** One scoped read model for the shared eight-section Home layout. */
  async getExperience(user: any) {
    const role = this.access.roleName(user);
    const isLeader = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);
    const isContributor = !isLeader;
    const now = this.tva.now();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const scope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    // Contributors' headline describes assigned work, not unassigned tickets
    // merely visible because they belong to the same department.
    const ownAssignments = {
      OR: [{ assignedToId: user.id }, { assignees: { some: { userId: user.id } } }],
    };
    const activeWhere = this.andWhere(
      scope,
      isContributor ? ownAssignments : {},
      { status: { notIn: TERMINAL_TICKET_STATUSES } },
    );
    const projectWhere = await this.access.projectWhereForUser(user);
    const leaveWhere = await this.leaveAccess.buildLeaveWhereForUser({}, user);
    const config = await this.timing.getSlaConfig();

    const [activeTickets, reviewTickets, projects, projectCount, pendingLeaves, ownPendingLeave, approvedLeaves, recognitionTickets, hierarchyRequests] = await Promise.all([
      this.prisma.ticket.findMany({ where: activeWhere, include: { assignees: { select: { userId: true } } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.ticket.findMany({ where: this.andWhere(scope, { status: TicketStatus.REVIEW }), include: { assignees: { select: { userId: true } } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.project.findMany({
        where: this.andWhere(projectWhere, { status: 'ACTIVE' }),
        select: {
          id: true, projectId: true, name: true, endDate: true, updatedAt: true,
          members: { select: { userId: true, role: true, user: { select: { name: true } } } },
          tickets: { include: { assignees: { select: { userId: true } } } },
        },
        orderBy: { updatedAt: 'desc' }, take: 20,
      }),
      this.prisma.project.count({ where: this.andWhere(projectWhere, { status: 'ACTIVE' }) }),
      isLeader || user.isHR
        ? this.prisma.leaveRequest.findMany({ where: this.andWhere(leaveWhere, { status: LeaveStatus.PENDING }), include: { user: { include: { role: true } } }, orderBy: { createdAt: 'desc' } })
        : Promise.resolve([]),
      isContributor && !user.isHR
        ? this.prisma.leaveRequest.count({ where: { userId: user.id, status: LeaveStatus.PENDING } })
        : Promise.resolve(0),
      this.prisma.leaveRequest.findMany({
        where: this.andWhere(leaveWhere, { status: LeaveStatus.APPROVED, startDate: { gte: now, lte: weekAhead } }),
        select: { id: true, startDate: true, user: { select: { name: true } } }, take: 6, orderBy: { startDate: 'asc' },
      }),
      this.prisma.ticket.findMany({
        where: this.andWhere(scope, { status: { in: [TicketStatus.DONE, TicketStatus.CLOSED] }, resolvedAt: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) } }),
        select: { id: true, ticketId: true, title: true, resolvedAt: true, assignedTo: { select: { name: true } } },
        orderBy: { resolvedAt: 'desc' }, take: 3,
      }),
      this.prisma.employeeProfileChangeRequest.findMany({
        where: { currentApproverId: user.id, status: { startsWith: 'PENDING' } },
        select: { id: true }, take: 3,
      }),
    ]);

    const timingById = new Map(activeTickets.map((ticket) => [ticket.id, this.timing.getTimingState(ticket, config, now)]));
    const isOverdue = (ticket: any) => (timingById.get(ticket.id) ?? this.timing.getTimingState(ticket, config, now)).isOverdue;
    const overdueTickets = activeTickets.filter(isOverdue);
    // Match TicketsService.getSlaRiskCategories: a four-hour active SLA window,
    // excluding blocked and already-overdue tickets from the other categories.
    const dueSoon = activeTickets.filter((ticket) => {
      const timing = timingById.get(ticket.id)!;
      return !ticket.isBlocked && !timing.isOverdue &&
        (timing.timerType === 'review' || timing.timerType === 'execution') &&
        timing.remainingMs > 0 && timing.remainingMs <= 4 * 3_600_000;
    });
    const ageingReviews = activeTickets.filter((ticket) => {
      const timing = timingById.get(ticket.id)!;
      return !ticket.isBlocked && !timing.isOverdue && timing.timerType === 'review' && timing.remainingMs <= 0;
    });

    // Visibility is not approval authority. Each candidate is checked using
    // the same service method used by the ticket decision endpoint.
    const actionableReviews: typeof reviewTickets = [];
    for (let index = 0; index < reviewTickets.length; index += 20) {
      const batch = reviewTickets.slice(index, index + 20);
      const allowed = await Promise.all(batch.map((ticket) => this.ticketAccess.viewerCanApprove(user, ticket)));
      for (let item = 0; item < batch.length; item++) {
        if (allowed[item]) actionableReviews.push(batch[item]);
      }
    }
    const actionableLeaves: typeof pendingLeaves = [];
    for (const leave of pendingLeaves) {
      if (await this.leaveService.viewerCanApprove(user, leave)) actionableLeaves.push(leave);
    }

    const actions = [
      ...overdueTickets.filter((ticket) => ticket.assignedToId === user.id || ticket.assignees.some((assignee) => assignee.userId === user.id)).slice(0, 2).map((ticket) => ({
        id: ticket.id, type: 'OVERDUE', title: 'Overdue ticket needs intervention', detail: `${ticket.ticketId} · ${ticket.title}`, url: `/tickets/${ticket.id}`,
      })),
      ...actionableReviews.slice(0, 2).map((ticket) => ({
        id: ticket.id, type: 'REVIEW', title: 'Ticket approval awaiting decision', detail: `${ticket.ticketId} · ${ticket.title}`, url: `/tickets/${ticket.id}`,
      })),
      ...actionableLeaves.slice(0, 2).map((leave) => ({
        id: leave.id, type: 'LEAVE', title: 'Leave request awaiting decision', detail: `${leave.user.name} · ${leave.type}`, url: '/leave?tab=needs-action',
      })),
      ...hierarchyRequests.map((request) => ({
        id: request.id, type: 'HIERARCHY', title: 'Hierarchy change request', detail: 'Administrative approval pending', url: '/admin/approvals',
      })),
    ].slice(0, 3);

    const upcoming = [
      ...dueSoon.slice(0, 6).map((ticket) => ({ id: ticket.id, type: 'Ticket deadline', title: ticket.title, date: timingById.get(ticket.id)?.dueAt, url: `/tickets/${ticket.id}` })),
      ...approvedLeaves.map((leave) => ({ id: leave.id, type: 'Approved leave', title: leave.user.name, date: leave.startDate, url: '/leave' })),
      ...projects.filter((project) => project.endDate && project.endDate >= now && project.endDate <= weekAhead).map((project) => ({ id: project.id, type: 'Project target date', title: project.name, date: project.endDate, url: `/projects/${project.id}` })),
    ].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime()).slice(0, 5);

    const [team, projectHours, personalSummary] = await Promise.all([
      this.getTeamInsights(user, activeTickets, isOverdue, now),
      projects.length && isLeader
        ? this.prisma.ticketTimeLog.findMany({
            where: { countsAsWork: true, durationSeconds: { not: null }, ticket: { projectId: { in: projects.map((project) => project.id) } } },
            select: { userId: true, durationSeconds: true, ticket: { select: { projectId: true } } },
          })
        : Promise.resolve([]),
      this.getPersonalSummary(user.id),
    ]);
    const hoursByProjectAndUser = new Map<string, number>();
    for (const log of projectHours) {
      const key = `${log.ticket.projectId}:${log.userId}`;
      hoursByProjectAndUser.set(key, (hoursByProjectAndUser.get(key) ?? 0) + (log.durationSeconds ?? 0));
    }

    return {
      scope: isContributor ? 'Personal' : role === 'TEAM_LEAD' ? 'Team' : role === 'MANAGER' ? 'Department' : 'Company',
      kpis: {
        activeTickets: activeTickets.length,
        activeProjects: projectCount,
        ticketReviews: isContributor
          ? reviewTickets.filter((ticket) => ticket.assignedToId === user.id || ticket.createdById === user.id || ticket.assignees.some((assignee) => assignee.userId === user.id)).length
          : actionableReviews.length,
        leaveReviews: isContributor && !user.isHR ? ownPendingLeave : actionableLeaves.length,
        ticketReviewLabel: isContributor ? 'In review' : 'Ticket reviews',
        leaveReviewLabel: isContributor && !user.isHR ? 'My leave requests' : 'Leave reviews',
      },
      recognition: recognitionTickets.map((ticket) => ({
        id: ticket.id, person: ticket.assignedTo?.name ?? 'Team member', title: ticket.title,
        ticketId: ticket.ticketId, date: ticket.resolvedAt, url: `/tickets/${ticket.id}`,
      })),
      personalSummary,
      team,
      projects: projects.map((project) => {
        const tickets = project.tickets;
        const done = tickets.filter((ticket) => ticket.status === TicketStatus.DONE || ticket.status === TicketStatus.CLOSED).length;
        const active = tickets.filter((ticket) => !TERMINAL_TICKET_STATUSES.includes(ticket.status)).length;
        const overdue = tickets.filter(isOverdue).length;
        const blocked = tickets.filter((ticket) => ticket.isBlocked).length;
        return {
          id: project.id, code: project.projectId, name: project.name, endDate: project.endDate,
          lead: project.members.find((member) => member.role === 'OWNER' || member.role === 'LEAD')?.user.name ?? null,
          progress: tickets.length ? Math.round((done / tickets.length) * 100) : 0,
          total: tickets.length, active, done, overdue, blocked,
          inProgress: tickets.filter((ticket) => ticket.status === TicketStatus.IN_PROGRESS).length,
          review: tickets.filter((ticket) => ticket.status === TicketStatus.REVIEW).length,
          todo: tickets.filter((ticket) => ticket.status === TicketStatus.OPEN).length,
          peopleCount: project.members.length,
          people: isLeader ? project.members.map((member) => {
            const mine = tickets.filter((ticket) => ticket.assignedToId === member.userId || ticket.assignees.some((assignee) => assignee.userId === member.userId));
            return {
              id: member.userId, name: member.user.name,
              active: mine.filter((ticket) => !TERMINAL_TICKET_STATUSES.includes(ticket.status)).length,
              done: mine.filter((ticket) => ticket.status === TicketStatus.DONE || ticket.status === TicketStatus.CLOSED).length,
              overdue: mine.filter(isOverdue).length,
              hours: Math.round((hoursByProjectAndUser.get(`${project.id}:${member.userId}`) ?? 0) / 3600 * 10) / 10,
            };
          }) : [],
        };
      }),
      radar: {
        overdue: overdueTickets.length,
        dueSoon: dueSoon.length,
        ageingReviews: ageingReviews.length,
        blocked: activeTickets.filter((ticket) => ticket.isBlocked).length,
        actions,
        upcoming,
        bottlenecks: activeTickets.filter((ticket) => ticket.isBlocked || isOverdue(ticket)).slice(0, 5).map((ticket) => ({
          id: ticket.id, code: ticket.ticketId, title: ticket.title, blocked: ticket.isBlocked, overdue: isOverdue(ticket), url: `/tickets/${ticket.id}`,
        })),
      },
    };
  }

  async getActivity(user: any, requestedScope?: string) {
    const role = this.access.roleName(user);
    const scope = requestedScope ?? 'my';
    if (!['my', 'team', 'company'].includes(scope)) throw new BadRequestException('Invalid activity scope');
    if (scope === 'company' && !this.access.isAdmin(user)) return [];
    if (scope === 'team' && !['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) return [];

    let actorIds: string[] | null = [user.id];
    if (scope === 'company') {
      actorIds = null;
    } else if (scope === 'team') {
      if (role === 'TEAM_LEAD') {
        const teams = await this.prisma.team.findMany({
          where: { teamLeadId: user.id, isActive: true },
          select: { members: { select: { userId: true } } },
        });
        actorIds = [...new Set([user.id, ...teams.flatMap((team) => team.members.map((member) => member.userId))])];
      } else {
        const departments = role === 'MANAGER'
          ? await this.access.managedDepartmentIds(user)
          : user.departmentId ? [user.departmentId] : [];
        const people = departments.length ? await this.prisma.user.findMany({
          where: { isActive: true, departmentId: { in: departments } }, select: { id: true },
        }) : [];
        actorIds = [...new Set([user.id, ...people.map((person) => person.id)])];
      }
    }

    const events = await this.prisma.operationalEvent.findMany({
      where: actorIds ? { actorId: { in: actorIds } } : {},
      select: { id: true, actorId: true, action: true, entityType: true, entityId: true, timestamp: true,
        actor: { select: { name: true } } },
      orderBy: { timestamp: 'desc' }, take: 12,
    });
    return events.map((event) => ({
      id: event.id, actorId: event.actorId, actor: event.actor.name,
      action: event.action.toLowerCase().replace(/_/g, ' '), date: event.timestamp,
      url: event.entityType === 'Ticket' ? `/tickets/${event.entityId}`
        : event.entityType === 'Project' ? `/projects/${event.entityId}`
        : event.entityType === 'LeaveRequest' ? '/leave' : null,
    }));
  }

  private async getPersonalSummary(userId: string) {
    const today = new Date(`${this.tva.companyToday()}T00:00:00.000Z`);
    const thisWeekStart = new Date(today);
    thisWeekStart.setUTCDate(today.getUTCDate() - today.getUTCDay());
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setUTCDate(thisWeekStart.getUTCDate() - 7);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(today.getUTCDate() + 1);
    const sessions = await this.prisma.workSession.findMany({
      where: { userId, date: { gte: lastWeekStart, lt: tomorrow }, logoutAt: { not: null } },
      select: { date: true, totalWorkMinutes: true },
    });
    const minutesByDay = new Map<string, number>();
    for (const session of sessions) {
      const day = session.date.toISOString().slice(0, 10);
      minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + session.totalWorkMinutes);
    }
    const thisWeekKey = thisWeekStart.toISOString().slice(0, 10);
    const lastWeekKey = lastWeekStart.toISOString().slice(0, 10);
    const previous = [...minutesByDay.entries()].filter(([day, minutes]) => day >= lastWeekKey && day < thisWeekKey && minutes > 0);
    const current = [...minutesByDay.entries()].filter(([day]) => day >= thisWeekKey);
    return {
      lastWeekAverageMinutes: previous.length ? Math.round(previous.reduce((sum, [, minutes]) => sum + minutes, 0) / previous.length) : null,
      thisWeekMinutes: current.length ? current.reduce((sum, [, minutes]) => sum + minutes, 0) : null,
      thisWeekDays: current.length,
    };
  }

  private async getTeamInsights(user: any, activeTickets: any[], isOverdue: (ticket: any) => boolean, now: Date) {
    const role = this.access.roleName(user);
    const detailed = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);
    let userIds: string[] | null = null;
    if (!detailed) {
      const memberships = await this.prisma.teamMember.findMany({ where: { userId: user.id, team: { isActive: true } }, select: { teamId: true } });
      const peers = memberships.length ? await this.prisma.teamMember.findMany({
        where: { teamId: { in: memberships.map((membership) => membership.teamId) }, team: { isActive: true } },
        select: { userId: true },
      }) : [];
      userIds = [...new Set(peers.map((peer) => peer.userId))];
      if (!userIds.length && user.departmentId) {
        const departmentPeers = await this.prisma.user.findMany({
          where: { isActive: true, departmentId: user.departmentId }, select: { id: true },
        });
        userIds = departmentPeers.map((peer) => peer.id);
      }
    } else if (role === 'TEAM_LEAD') {
      const teams = await this.prisma.team.findMany({
        where: { teamLeadId: user.id, isActive: true }, select: { members: { select: { userId: true } } },
      });
      userIds = [...new Set(teams.flatMap((team) => team.members.map((member) => member.userId)))];
      if (!userIds.length) {
        const departments = await this.access.managedDepartmentIds(user);
        const departmentPeers = await this.prisma.user.findMany({
          where: { isActive: true, departmentId: { in: departments } }, select: { id: true },
        });
        userIds = departmentPeers.map((peer) => peer.id);
      }
    } else if (role === 'MANAGER') {
      const departments = await this.access.managedDepartmentIds(user);
      const members = await this.prisma.user.findMany({ where: { isActive: true, departmentId: { in: departments } }, select: { id: true } });
      userIds = members.map((member) => member.id);
    }
    const users = await this.prisma.user.findMany({
      where: { isActive: true, id: { not: user.id }, ...(userIds ? { id: { in: userIds.filter((id) => id !== user.id) } } : {}) },
      select: { id: true, name: true, currentStatus: true }, orderBy: { name: 'asc' }, take: 150,
    });
    if (!users.length) return { detailed, rows: [], attentionCount: 0 };
    const ids = users.map((member) => member.id);
    const today = this.tva.companyDateOnly();
    const [leaves, sessions, previousSessions] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { userId: { in: ids }, status: LeaveStatus.APPROVED, startDate: { lte: today }, endDate: { gte: today } }, select: { userId: true },
      }),
      detailed ? this.prisma.workSession.findMany({ where: { userId: { in: ids }, date: today }, include: { breakLogs: true }, orderBy: { createdAt: 'asc' } }) : Promise.resolve([]),
      detailed ? this.prisma.workSession.findMany({
        where: { userId: { in: ids }, date: { gte: this.tva.companyDateOnly(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)), lt: today }, logoutAt: { not: null } },
        select: { userId: true, date: true, totalWorkMinutes: true },
      }) : Promise.resolve([]),
    ]);
    const onLeave = new Set(leaves.map((leave) => leave.userId));
    const rows = users.map((member) => {
      const assigned = activeTickets.filter((ticket) => ticket.assignedToId === member.id || ticket.assignees.some((assignee: any) => assignee.userId === member.id));
      const memberSessions = sessions.filter((session) => session.userId === member.id).map((session) => ({
        ...session,
        breakLogs: session.breakLogs.filter((entry) => entry.breakType !== 'MEETING'),
      }));
      const workMinutes = memberSessions.length ? calculateWorkdayRuntime(memberSessions as any, now).elapsedWorkMinutes : null;
      const pastByDay = new Map<string, number>();
      for (const session of previousSessions.filter((session) => session.userId === member.id)) {
        const date = session.date.toISOString().slice(0, 10);
        pastByDay.set(date, (pastByDay.get(date) ?? 0) + session.totalWorkMinutes);
      }
      const past = [...pastByDay.values()];
      return {
        id: member.id, name: member.name,
        status: onLeave.has(member.id) ? 'ON_LEAVE' : member.currentStatus,
        active: detailed ? assigned.length : null,
        overdue: detailed ? assigned.filter(isOverdue).length : null,
        productiveMinutes: detailed ? workMinutes : null,
        averageMinutes: detailed && past.length ? Math.round(past.reduce((sum, minutes) => sum + minutes, 0) / past.length) : null,
      };
    });
    const attentionCount = detailed ? rows.filter((member) => (member.overdue ?? 0) > 0 || (member.active ?? 0) > 0 && member.status === 'ON_LEAVE').length : 0;
    rows.sort((a, b) => (b.overdue ?? 0) - (a.overdue ?? 0) || (b.active ?? 0) - (a.active ?? 0) || a.name.localeCompare(b.name));
    return { detailed, rows: rows.slice(0, 6), attentionCount };
  }
}
