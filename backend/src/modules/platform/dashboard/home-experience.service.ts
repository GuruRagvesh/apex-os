import { BadRequestException, Injectable } from '@nestjs/common';
import { LeaveStatus, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';
import { TVAService } from '../../../common/services/tva.service';
import { LeaveService } from '../../operations/leave/leave.service';

const TERMINAL_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.PENDING_APPROVAL,
  TicketStatus.DONE,
  TicketStatus.CLOSED,
];

const WORKSPACE_ESSENTIALS_LIMIT = 5;
const WORKSPACE_NOTES_LIMIT = 3;

type WorkspaceEssential = { id: string; label: string; url: string };

function defaultEssentials(): WorkspaceEssential[] {
  return Array.from({ length: WORKSPACE_ESSENTIALS_LIMIT }, (_, index) => ({
    id: `essential-${index + 1}`,
    label: `Essential ${index + 1}`,
    url: '',
  }));
}

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

  private workspaceEssentials(raw: unknown): WorkspaceEssential[] {
    const defaults = defaultEssentials();
    if (Array.isArray(raw)) {
      return defaults.map((fallback, index) => {
        const item = raw[index];
        if (!item || typeof item !== 'object' || Array.isArray(item)) return fallback;
        const value = item as Record<string, unknown>;
        return {
          id: typeof value.id === 'string' ? value.id : fallback.id,
          label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : fallback.label,
          url: typeof value.url === 'string' ? value.url : '',
        };
      });
    }
    // Existing users have the former Mail/Teams/Drive object. Preserve those
    // values and give them two additional editable slots without a migration.
    if (raw && typeof raw === 'object') {
      const legacy = raw as Record<string, unknown>;
      const names = ['Mail', 'Teams', 'Drive'];
      const keys = ['mail', 'teams', 'drive'];
      return defaults.map((fallback, index) => index < keys.length
        ? { ...fallback, label: names[index], url: typeof legacy[keys[index]] === 'string' ? legacy[keys[index]] as string : '' }
        : fallback);
    }
    return defaults;
  }

  private workspaceNotes(raw: string | null | undefined): string[] {
    if (!raw) return Array.from({ length: WORKSPACE_NOTES_LIMIT }, () => '');
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version === 1 && Array.isArray(parsed.items)) {
        return Array.from({ length: WORKSPACE_NOTES_LIMIT }, (_, index) => typeof parsed.items[index] === 'string' ? parsed.items[index] : '');
      }
    } catch { /* Legacy plain-text note; it belongs in Note 1. */ }
    return [raw, '', ''];
  }

  async getWorkspace(userId: string) {
    const row = await this.prisma.dashboardWorkspace.findUnique({ where: { userId } });
    const today = this.tva.companyToday();
    const checklist = Array.isArray(row?.checklist) ? row.checklist as any[] : [];
    return {
      notes: this.workspaceNotes(row?.notes),
      checklist: checklist.map((item) => ({
        id: item.id, text: item.text, done: item.completedOn === today,
      })),
      essentials: this.workspaceEssentials(row?.shortcuts),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async updateWorkspace(userId: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Workspace must be an object');
    }
    const body = input as Record<string, unknown>;
    const allowed = ['notes', 'checklist', 'essentials', 'shortcuts'];
    if (Object.keys(body).some((key) => !allowed.includes(key)) || !Object.keys(body).length) {
      throw new BadRequestException('Unknown or missing workspace fields');
    }
    const data: any = {};
    if ('notes' in body) {
      if (typeof body.notes === 'string') {
        if (body.notes.length > 5000) throw new BadRequestException('Notes must be 5000 characters or fewer');
        data.notes = body.notes;
      } else if (!Array.isArray(body.notes) || body.notes.length > WORKSPACE_NOTES_LIMIT || body.notes.some((note) => typeof note !== 'string' || note.length > 1600)) {
        throw new BadRequestException('Workspace can contain up to three notes of 1600 characters each');
      } else {
        data.notes = JSON.stringify({ version: 1, items: body.notes });
      }
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
    if ('essentials' in body) {
      if (!Array.isArray(body.essentials) || body.essentials.length !== WORKSPACE_ESSENTIALS_LIMIT) {
        throw new BadRequestException('Workspace must contain exactly five essentials');
      }
      const ids = new Set<string>();
      const essentials = body.essentials.map((item: any, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item) ||
          typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id) ||
          typeof item.label !== 'string' || !item.label.trim() || item.label.trim().length > 40 ||
          typeof item.url !== 'string' || item.url.length > 500 || (item.url && !/^https:\/\/[^\s]+$/i.test(item.url))) {
          throw new BadRequestException(`Essential ${index + 1} is invalid`);
        }
        ids.add(item.id);
        return { id: item.id, label: item.label.trim(), url: item.url };
      });
      data.shortcuts = essentials;
    } else if ('shortcuts' in body) {
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

  /** One scoped read model for the shared Home layout. */
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
        select: { id: true, name: true, endDate: true },
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

    const [team, personalSummary] = await Promise.all([
      this.getTeamHierarchy(user),
      this.getPersonalSummary(user.id),
    ]);

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

  /**
   * Filter options for the intentionally blank Team Insights canvas.
   *
   * Hierarchy comes from relations, never from names or a user's free-text
   * designation:
   * - Team Lead: active teams they lead and those teams' active contributors.
   * - Manager: departments in ManagerDeptAccess and everyone below Manager in
   *   those departments.
   * - Admin/Super Admin: every department, its assigned Manager(s), Team Leads
   *   and contributors.
   */
  private async getTeamHierarchy(user: any) {
    const role = this.access.roleName(user);
    const detailed = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);
    const empty = {
      detailed,
      rows: [],
      attentionCount: 0,
      hierarchyRole: role,
      showDepartmentFilter: false,
      departments: [],
    };
    if (!detailed) return empty;

    if (role === 'TEAM_LEAD') {
      const teams = await this.prisma.team.findMany({
        where: { teamLeadId: user.id, isActive: true },
        select: {
          id: true,
          name: true,
          department: { select: { id: true, name: true } },
          members: {
            where: {
              user: {
                isActive: true,
                role: { name: { in: ['EMPLOYEE', 'INTERN'] } },
              },
            },
            select: {
              user: { select: { id: true, name: true, role: { select: { name: true } } } },
            },
          },
        },
        orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
      });

      const grouped = new Map<string, { id: string; name: string; people: any[] }>();
      for (const team of teams) {
        const department = grouped.get(team.department.id) ?? {
          id: team.department.id,
          name: team.department.name,
          people: [],
        };
        const known = new Set(department.people.map((person) => person.id));
        for (const member of team.members) {
          if (known.has(member.user.id)) continue;
          known.add(member.user.id);
          department.people.push({
            id: member.user.id,
            name: member.user.name,
            role: member.user.role.name,
            teamId: team.id,
            teamName: team.name,
          });
        }
        grouped.set(team.department.id, department);
      }
      const departments = [...grouped.values()].map((department) => ({
        ...department,
        people: department.people.sort((a, b) => a.name.localeCompare(b.name)),
      }));
      return { ...empty, departments };
    }

    let departmentIds: string[] | null = null;
    if (role === 'MANAGER') {
      const assignments = await this.prisma.managerDeptAccess.findMany({
        where: { managerId: user.id },
        select: { departmentId: true },
      });
      departmentIds = [...new Set(assignments.map((assignment) => assignment.departmentId))];
      // Preserve old installations that predate ManagerDeptAccess without
      // mixing a Manager's unrelated profile department into explicit scope.
      if (!departmentIds.length && user.departmentId) departmentIds = [user.departmentId];
    }
    const departments = await this.prisma.department.findMany({
      where: departmentIds ? { id: { in: departmentIds } } : {},
      select: {
        id: true,
        name: true,
        managerAccess: {
          where: { manager: { isActive: true, role: { name: 'MANAGER' } } },
          select: { manager: { select: { id: true, name: true, role: { select: { name: true } } } } },
        },
        users: {
          where: {
            isActive: true,
            role: { name: { in: ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'] } },
          },
          select: { id: true, name: true, role: { select: { name: true } } },
        },
        teams: {
          where: { isActive: true, teamLead: { isActive: true, role: { name: 'TEAM_LEAD' } } },
          select: {
            id: true,
            name: true,
            teamLead: { select: { id: true, name: true, role: { select: { name: true } } } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const roleRank: Record<string, number> = { MANAGER: 0, TEAM_LEAD: 1, EMPLOYEE: 2, INTERN: 3 };
    const hierarchy = departments.map((department) => {
      const people = new Map<string, { id: string; name: string; role: string; teamId?: string; teamName?: string }>();

      // Managers belong to a department through ManagerDeptAccess, not through
      // their primary User.departmentId. Only company-wide viewers see them in
      // the person filter; a Manager never sees themselves or peer Managers.
      if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
        for (const access of department.managerAccess) {
          if (access.manager.id !== user.id) {
            people.set(access.manager.id, {
              id: access.manager.id,
              name: access.manager.name,
              role: access.manager.role.name,
            });
          }
        }
      }

      const teamByLead = new Map(department.teams
        .filter((team) => team.teamLead)
        .map((team) => [team.teamLead!.id, team]));
      for (const team of department.teams) {
        if (!team.teamLead || team.teamLead.id === user.id) continue;
        people.set(team.teamLead.id, {
          id: team.teamLead.id,
          name: team.teamLead.name,
          role: team.teamLead.role.name,
          teamId: team.id,
          teamName: team.name,
        });
      }
      for (const member of department.users) {
        if (member.id === user.id) continue;
        const team = teamByLead.get(member.id);
        people.set(member.id, {
          id: member.id,
          name: member.name,
          role: member.role.name,
          ...(team ? { teamId: team.id, teamName: team.name } : {}),
        });
      }

      return {
        id: department.id,
        name: department.name,
        people: [...people.values()].sort((a, b) =>
          (roleRank[a.role] ?? 99) - (roleRank[b.role] ?? 99) || a.name.localeCompare(b.name)),
      };
    });

    return {
      ...empty,
      showDepartmentFilter: role === 'ADMIN' || role === 'SUPER_ADMIN' || hierarchy.length > 1,
      departments: hierarchy,
    };
  }
}
