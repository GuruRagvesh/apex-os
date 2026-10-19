import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { TVAService } from '../../../common/services/tva.service';

const LEADER_ROLES = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];
const PERSONAL_INSIGHT_ROLES = ['INTERN', 'EMPLOYEE', 'TEAM_LEAD', 'MANAGER'];
const ACTIVE_TICKET_STATUSES: TicketStatus[] = [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.REVIEW];
const DATE_RE = /^\d{4}-\d{2}$/;
const INSIGHT_CACHE_TTL_MS = 5_000;

type Range = { from: string; to: string; start: Date; end: Date; days: number };
type Interval = { start: number; end: number };

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, amount: number) {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return isoDay(value);
}

function intervalOverlaps(start: Date, end: Date | null, range: Range) {
  return start < range.end && (!end || end > range.start);
}

function ticketHadStatus(ticket: any, status: TicketStatus, range: Range) {
  const history = [...(ticket.history ?? [])]
    .filter((entry: any) => entry.field === 'status')
    .sort((a: any, b: any) => a.changedAt.getTime() - b.changedAt.getTime());

  if (history.length) {
    let current = (history[0].oldValue ?? TicketStatus.OPEN) as TicketStatus;
    let startedAt = ticket.createdAt as Date;
    for (const entry of history) {
      if (current === status && intervalOverlaps(startedAt, entry.changedAt, range)) return true;
      current = entry.newValue as TicketStatus;
      startedAt = entry.changedAt;
    }
    return current === status && intervalOverlaps(startedAt, null, range);
  }

  // Older imported tickets may not have a status audit trail. Their milestone
  // timestamps provide a conservative fallback without manufacturing data.
  const completedAt = ticket.closedAt ?? ticket.resolvedAt ?? ticket.actualCompletedAt ?? ticket.cancelledAt ?? null;
  const reviewAt = ticket.reviewStartedAt ?? ticket.submittedAt ?? null;
  const progressAt = ticket.actualStartAt ?? null;
  if (status === TicketStatus.OPEN) {
    const endedAt = progressAt ?? reviewAt ?? completedAt ?? (ticket.status === TicketStatus.OPEN ? null : ticket.updatedAt);
    return intervalOverlaps(ticket.createdAt, endedAt, range);
  }
  if (status === TicketStatus.IN_PROGRESS) {
    const startedAt = progressAt ?? (ticket.status === TicketStatus.IN_PROGRESS ? ticket.createdAt : null);
    return !!startedAt && intervalOverlaps(startedAt, reviewAt ?? completedAt, range);
  }
  if (status === TicketStatus.REVIEW) {
    const startedAt = reviewAt ?? (ticket.status === TicketStatus.REVIEW ? ticket.createdAt : null);
    return !!startedAt && intervalOverlaps(startedAt, completedAt, range);
  }
  return false;
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? ''}${words.length > 1 ? words[words.length - 1][0] : ''}`.toUpperCase();
}

function clippedInterval(start: Date | null | undefined, end: Date | null | undefined, range: Range, now: Date): Interval | null {
  if (!start) return null;
  const left = Math.max(start.getTime(), range.start.getTime());
  const right = Math.min((end ?? now).getTime(), range.end.getTime(), now.getTime());
  return right > left ? { start: left, end: right } : null;
}

export function unionMinutes(intervals: Interval[]) {
  if (!intervals.length) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0;
  let start = sorted[0].start;
  let end = sorted[0].end;
  for (const interval of sorted.slice(1)) {
    if (interval.start <= end) end = Math.max(end, interval.end);
    else {
      total += end - start;
      start = interval.start;
      end = interval.end;
    }
  }
  total += end - start;
  return Math.round(total / 60_000);
}

export function netSessionMinutes(session: Interval, breaks: Interval[]) {
  const grossMinutes = Math.round((session.end - session.start) / 60_000);
  const clippedBreaks = breaks
    .map((item) => ({ start: Math.max(item.start, session.start), end: Math.min(item.end, session.end) }))
    .filter((item) => item.end > item.start);
  return Math.max(0, grossMinutes - unionMinutes(clippedBreaks));
}

@Injectable()
export class TeamInsightsService {
  private readonly insightCache = new Map<string, { expiresAt: number; revision: string; value: unknown }>();
  private readonly insightInFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly timing: TicketTimingService,
    private readonly tva: TVAService,
  ) {}

  private monthWeeks(month: string) {
    const first = `${month}-01`;
    const cursor = new Date(`${first}T00:00:00.000Z`);
    const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const last = addDays(isoDay(nextMonth), -1);
    const weeks: { value: number; label: string; from: string; to: string }[] = [];
    // Every option is a real Monday-to-Sunday week. Boundary weeks may include
    // days from the adjacent month, but never become misleading 2- or 3-day weeks.
    const daysSinceMonday = (cursor.getUTCDay() + 6) % 7;
    let from = addDays(first, -daysSinceMonday);
    let value = 1;
    while (from <= last) {
      const to = addDays(from, 6);
      weeks.push({ value, label: `Week ${value}`, from, to });
      from = addDays(to, 1);
      value += 1;
    }
    return weeks;
  }

  /**
   * A cheap global change token for every table used by Team Insights. Once a
   * cached answer is a few seconds old, refresh checks these MAX timestamps.
   * If they are unchanged, the verified answer is reused and none of the
   * expensive analytics queries run again.
   */
  private async dataRevision() {
    const revisions = await Promise.all([
      this.prisma.user.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.project.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.ticket.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.workSession.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.breakLog.aggregate({ _count: { _all: true }, _max: { createdAt: true, endAt: true } }),
      this.prisma.ticketTimeLog.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.reviewCycleLog.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.meeting.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.dailyAttendance.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    ]);
    return JSON.stringify(revisions.map((entry) => [
      entry._count._all,
      ...Object.values(entry._max).map((value) => value instanceof Date ? value.getTime() : value),
    ]));
  }

  private resolveRange(month?: string, week?: string): { range: Range; weeks: ReturnType<TeamInsightsService['monthWeeks']>; mode: 'MONTH' | 'WEEK' } {
    const selectedMonth = month && DATE_RE.test(month) ? month : this.tva.companyToday().slice(0, 7);
    if (!DATE_RE.test(selectedMonth)) throw new BadRequestException('month must be YYYY-MM');
    const weeks = this.monthWeeks(selectedMonth);
    const parsedWeek = week && week !== 'all' ? Number(week) : null;
    const selected = parsedWeek ? weeks.find((item) => item.value === parsedWeek) : null;
    if (parsedWeek && !selected) throw new BadRequestException('week is not valid for the selected month');
    const from = selected?.from ?? `${selectedMonth}-01`;
    const monthCursor = new Date(`${selectedMonth}-01T00:00:00.000Z`);
    const nextMonth = new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 1));
    const to = selected?.to ?? addDays(isoDay(nextMonth), -1);
    const start = this.tva.companyInstantAt(from, '00:00') as Date;
    const end = this.tva.companyInstantAt(addDays(to, 1), '00:00') as Date;
    return {
      weeks,
      mode: selected ? 'WEEK' : 'MONTH',
      range: { from, to, start, end, days: Math.round((end.getTime() - start.getTime()) / 86_400_000) },
    };
  }

  private async allowedScope(viewer: any, departmentId?: string) {
    const role = this.access.roleName(viewer);
    if (!LEADER_ROLES.includes(role)) throw new ForbiddenException('Team insights are available to authorized leaders only.');

    if (role === 'TEAM_LEAD') {
      const teams = await this.prisma.team.findMany({
        where: { teamLeadId: viewer.id, isActive: true },
        select: { members: { where: { user: { isActive: true, role: { name: { in: ['EMPLOYEE', 'INTERN'] } } } }, select: { userId: true } } },
      });
      return { role, departmentId: null, userIds: [...new Set(teams.flatMap((team) => team.members.map((member) => member.userId)))] };
    }

    let allowedDepartments: string[] | null = null;
    if (role === 'MANAGER') {
      const rows = await this.prisma.managerDeptAccess.findMany({ where: { managerId: viewer.id }, select: { departmentId: true } });
      allowedDepartments = [...new Set(rows.map((row) => row.departmentId))];
      if (!allowedDepartments.length && viewer.departmentId) allowedDepartments = [viewer.departmentId];
    }
    if (departmentId && allowedDepartments && !allowedDepartments.includes(departmentId)) {
      throw new ForbiddenException('That department is outside your assigned scope.');
    }
    const selectedDepartment = departmentId || null;
    const departmentWhere = selectedDepartment
      ? { departmentId: selectedDepartment }
      : allowedDepartments ? { departmentId: { in: allowedDepartments } } : {};
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        isSystemAccount: false,
        id: { not: viewer.id },
        role: { name: { in: ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'] } },
        ...departmentWhere,
      },
      select: { id: true },
    });
    if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
      const managerAccess = await this.prisma.managerDeptAccess.findMany({
        where: {
          ...(selectedDepartment ? { departmentId: selectedDepartment } : {}),
          manager: { isActive: true, isSystemAccount: false, role: { name: 'MANAGER' } },
        },
        select: { managerId: true },
      });
      return { role, departmentId: selectedDepartment, userIds: [...new Set([...users.map((user) => user.id), ...managerAccess.map((row) => row.managerId)])] };
    }
    return { role, departmentId: selectedDepartment, userIds: users.map((user) => user.id) };
  }

  private async timeMetrics(userIds: string[], range: Range, overall = false) {
    if (!userIds.length) return {
      workingMinutes: 0, breakMinutes: 0, ticketMinutes: 0, meetingMinutes: 0,
      productiveMinutes: 0, meetingCount: 0, daysWorked: 0, calendarDaysWorked: 0,
    };
    const now = this.tva.now();
    const [sessions, breaks, ticketLogs, meetings] = await Promise.all([
      this.prisma.workSession.findMany({
        where: { userId: { in: userIds }, date: { gte: range.start, lt: range.end }, startWorkAt: { not: null } },
        select: { id: true, userId: true, date: true, startWorkAt: true, logoutAt: true },
      }),
      this.prisma.breakLog.findMany({
        where: { userId: { in: userIds }, startAt: { lt: range.end }, OR: [{ endAt: null }, { endAt: { gt: range.start } }] },
        select: { userId: true, breakType: true, startAt: true, endAt: true },
      }),
      this.prisma.ticketTimeLog.findMany({
        where: { userId: { in: userIds }, countsAsWork: true, startedAt: { lt: range.end }, OR: [{ endedAt: null }, { endedAt: { gt: range.start } }] },
        select: { userId: true, startedAt: true, endedAt: true },
      }),
      this.prisma.meeting.findMany({
        where: {
          status: 'COMPLETED', approvalStatus: { in: ['APPROVED', 'NOT_REQUIRED'] }, startedAt: { lt: range.end }, endedAt: { gt: range.start },
          ...(overall ? { visibility: 'SHARED' } : {}),
          participants: { some: { userId: { in: userIds }, status: { in: ['ACCEPTED', 'LEFT'] } } },
        },
        select: {
          id: true, visibility: true, startedAt: true, endedAt: true,
          participants: { where: { userId: { in: userIds }, status: { in: ['ACCEPTED', 'LEFT'] } }, select: { userId: true, joinedAt: true, leftAt: true } },
        },
      }),
    ]);

    const breaksByUser = new Map<string, Interval[]>();
    for (const row of breaks) {
      if (row.breakType === 'MEETING') continue;
      const interval = clippedInterval(row.startAt, row.endAt, range, now);
      if (!interval) continue;
      breaksByUser.set(row.userId, [...(breaksByUser.get(row.userId) ?? []), interval]);
    }
    let workingMinutes = 0;
    const workedDays = new Set<string>();
    for (const session of sessions) {
      const interval = clippedInterval(session.startWorkAt, session.logoutAt, range, now);
      if (!interval) continue;
      workingMinutes += netSessionMinutes(interval, breaksByUser.get(session.userId) ?? []);
      workedDays.add(`${session.userId}:${isoDay(session.date)}`);
    }
    const ticketByUser = new Map<string, Interval[]>();
    for (const row of ticketLogs) {
      const interval = clippedInterval(row.startedAt, row.endedAt, range, now);
      if (interval) ticketByUser.set(row.userId, [...(ticketByUser.get(row.userId) ?? []), interval]);
    }
    const meetingByUser = new Map<string, Interval[]>();
    let meetingCount = 0;
    for (const meeting of meetings) {
      const interval = clippedInterval(meeting.startedAt, meeting.endedAt, range, now);
      if (!interval) continue;
      // A shared meeting with five scoped participants is one meeting, not five.
      meetingCount += 1;
      for (const participant of meeting.participants) {
        if (!participant.userId) continue;
        const own = clippedInterval(participant.joinedAt ?? meeting.startedAt, participant.leftAt ?? meeting.endedAt, range, now);
        if (own) meetingByUser.set(participant.userId, [...(meetingByUser.get(participant.userId) ?? []), own]);
      }
    }
    let ticketMinutes = 0;
    let meetingMinutes = 0;
    let productiveMinutes = 0;
    let breakMinutes = 0;
    for (const userId of userIds) {
      const tickets = ticketByUser.get(userId) ?? [];
      const userMeetings = meetingByUser.get(userId) ?? [];
      ticketMinutes += unionMinutes(tickets);
      meetingMinutes += unionMinutes(userMeetings);
      productiveMinutes += unionMinutes([...tickets, ...userMeetings]);
      breakMinutes += unionMinutes(breaksByUser.get(userId) ?? []);
    }
    const calendarDaysWorked = new Set([...workedDays].map((item) => item.slice(item.indexOf(':') + 1))).size;
    return { workingMinutes, breakMinutes, ticketMinutes, meetingMinutes, productiveMinutes, meetingCount, daysWorked: workedDays.size, calendarDaysWorked };
  }

  private async liveIdentity(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, photoUrl: true, avatar: true, currentStatus: true, role: { select: { name: true } }, department: { select: { id: true, name: true } } },
    });
    if (!user) throw new BadRequestException('The selected person is unavailable.');
    const today = this.tva.companyInstantAt(this.tva.companyToday(), '00:00') as Date;
    const session = await this.prisma.workSession.findFirst({
      where: { userId, date: today, logoutAt: null },
      select: {
        startWorkAt: true, status: true,
        breakLogs: { where: { endAt: null }, select: { breakType: true, startAt: true }, orderBy: { startAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    const now = this.tva.now();
    const openBreak = session?.breakLogs[0];
    const status = session?.status === 'ON_BREAK' && openBreak?.breakType === 'MEETING'
      ? 'IN_MEETING' : session?.status ?? user.currentStatus;
    const range: Range = { from: this.tva.companyToday(), to: this.tva.companyToday(), start: today, end: this.tva.companyInstantAt(addDays(this.tva.companyToday(), 1), '00:00') as Date, days: 1 };
    const todayMetrics = await this.timeMetrics([userId], range);
    return {
      id: user.id, name: user.name, initials: initials(user.name), photoUrl: user.photoUrl ?? user.avatar,
      role: user.role.name, department: user.department, status,
      workingMinutes: todayMetrics.workingMinutes,
      activeBreakMinutes: status === 'ON_BREAK' && openBreak ? Math.max(0, Math.floor((now.getTime() - openBreak.startAt.getTime()) / 60_000)) : 0,
    };
  }

  private async ticketMetrics(userIds: string[], range: Range) {
    if (!userIds.length) return { active: 0, inProgress: 0, underReview: 0, sentForReview: 0, executionOverdue: 0, reviewOverdue: 0, reworkTickets: 0, reworkAttempts: 0 };
    const assignment = { OR: [{ assignedToId: { in: userIds } }, { assignees: { some: { userId: { in: userIds } } } }] };
    const [tickets, reviewStarts, reworks, config] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { AND: [assignment, { createdAt: { lt: range.end } }] },
        include: {
          assignees: { select: { userId: true } },
          history: { where: { field: 'status' }, orderBy: { changedAt: 'asc' } },
        },
      }),
      this.prisma.reviewCycleLog.findMany({
        where: { assigneeId: { in: userIds }, reviewStartedAt: { gte: range.start, lt: range.end } },
        select: { ticketId: true },
      }),
      this.prisma.reviewCycleLog.findMany({
        where: { assigneeId: { in: userIds }, decision: 'REWORK', reviewEndedAt: { gte: range.start, lt: range.end } },
        select: { ticketId: true },
      }),
      this.timing.getSlaConfig(),
    ]);
    let executionOverdue = 0;
    let reviewOverdue = 0;
    for (const ticket of tickets) {
      const state = this.timing.getTimingState(ticket, config, this.tva.now());
      if (!state.isOverdue) continue;
      if (ticket.status === TicketStatus.REVIEW) reviewOverdue += 1;
      else if (ticket.status === TicketStatus.OPEN || ticket.status === TicketStatus.IN_PROGRESS) executionOverdue += 1;
    }
    const activeInPeriod = tickets.filter((ticket) => ACTIVE_TICKET_STATUSES.some((status) => ticketHadStatus(ticket, status, range)));
    return {
      active: activeInPeriod.length,
      inProgress: tickets.filter((ticket) => ticketHadStatus(ticket, TicketStatus.IN_PROGRESS, range)).length,
      underReview: tickets.filter((ticket) => ticketHadStatus(ticket, TicketStatus.REVIEW, range)).length,
      sentForReview: new Set(reviewStarts.map((row) => row.ticketId)).size,
      executionOverdue,
      reviewOverdue,
      reworkTickets: new Set(reworks.map((row) => row.ticketId)).size,
      reworkAttempts: reworks.length,
    };
  }

  private async attendance(userId: string, range: Range) {
    const rows = await this.prisma.dailyAttendance.findMany({
      where: { userId, date: { gte: range.start, lt: range.end } },
      select: { date: true, status: true, workedMinutes: true, breakMinutes: true, lateMinutes: true },
      orderBy: { date: 'asc' },
    });
    const counts = { present: 0, late: 0, halfDay: 0, leave: 0, weeklyOff: 0, holiday: 0, needsReview: 0 };
    for (const row of rows) {
      if (row.status === 'PRESENT') counts.present += 1;
      if (row.status === 'LATE' || row.status === 'LATE_EXEMPTED') counts.late += 1;
      if (row.status === 'HALF_DAY') counts.halfDay += 1;
      if (row.status === 'LEAVE' || row.status === 'LWP' || row.status === 'ABSENT') counts.leave += 1;
      if (row.status === 'WEEKLY_OFF') counts.weeklyOff += 1;
      if (row.status === 'HOLIDAY') counts.holiday += 1;
      if (['MISSING_PUNCH', 'PENDING_REGULARIZATION', 'GEO_MISMATCH', 'FACE_MISSING'].includes(row.status)) counts.needsReview += 1;
    }
    return { counts, days: rows.map((row) => ({ date: isoDay(row.date), status: row.status, workedMinutes: row.workedMinutes, breakMinutes: row.breakMinutes, lateMinutes: row.lateMinutes })) };
  }

  private async projects(userIds: string[], range: Range, showContribution = true) {
    if (!userIds.length) return [];
    const assignment = (ticket: any) => ticket.assignedToId && userIds.includes(ticket.assignedToId)
      || ticket.assignees.some((assignee: any) => userIds.includes(assignee.userId));
    const activityLogs = await this.prisma.ticketTimeLog.findMany({
      where: { userId: { in: userIds }, startedAt: { lt: range.end }, OR: [{ endedAt: null }, { endedAt: { gt: range.start } }] },
      select: { ticketId: true },
    });
    const activeTicketIds = new Set(activityLogs.map((row) => row.ticketId));
    const projects = await this.prisma.project.findMany({
      where: { tickets: { some: { OR: [{ assignedToId: { in: userIds } }, { assignees: { some: { userId: { in: userIds } } } }] } } },
      select: {
        id: true, projectId: true, name: true, status: true, endDate: true,
        tickets: { select: {
          id: true, status: true, assignedToId: true, dueDate: true, executionDueAt: true, reviewDueAt: true,
          createdAt: true, actualStartAt: true, submittedAt: true, closedAt: true, resolvedAt: true,
          assignees: { select: { userId: true } },
        } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    });
    const now = this.tva.now();
    return projects.map((project) => {
      const inPeriod = (ticket: any) => activeTicketIds.has(ticket.id)
        || [ticket.createdAt, ticket.actualStartAt, ticket.submittedAt, ticket.closedAt, ticket.resolvedAt]
          .some((value) => value && value >= range.start && value < range.end);
      const mine = project.tickets.filter((ticket) => assignment(ticket) && inPeriod(ticket));
      const done = mine.filter((ticket) => ticket.status === TicketStatus.DONE || ticket.status === TicketStatus.CLOSED).length;
      const active = mine.filter((ticket) => ACTIVE_TICKET_STATUSES.includes(ticket.status)).length;
      const overdue = mine.filter((ticket) => {
        if (!ACTIVE_TICKET_STATUSES.includes(ticket.status)) return false;
        const due = ticket.status === TicketStatus.REVIEW ? ticket.reviewDueAt : ticket.executionDueAt ?? ticket.dueDate;
        return !!due && due < now;
      }).length;
      const allDone = project.tickets.filter((ticket) => inPeriod(ticket) && (ticket.status === TicketStatus.DONE || ticket.status === TicketStatus.CLOSED)).length;
      return {
        id: project.id, code: project.projectId, name: project.name, status: project.status,
        finishedAt: project.endDate, assigned: mine.length, done, active, overdue,
        // A company-wide numerator contains the same people as the denominator,
        // which would turn every populated project into a meaningless 100%.
        contributionPercent: showContribution && allDone ? Math.round(done / allDone * 100) : null,
        hasStatusConflict: project.status === 'COMPLETED' && active > 0,
      };
    }).filter((project) => project.assigned > 0);
  }

  private async achievementStats(userIds: string[], range: Range) {
    type Stats = {
      daysWorked: number; workingMinutes: number; productiveMinutes: number; breakMinutes: number;
      completedTickets: number; attendanceDays: number; onTimeDays: number;
    };
    const stats = new Map<string, Stats>(userIds.map((id) => [id, {
      daysWorked: 0, workingMinutes: 0, productiveMinutes: 0, breakMinutes: 0,
      completedTickets: 0, attendanceDays: 0, onTimeDays: 0,
    }]));
    if (!userIds.length) return stats;
    const now = this.tva.now();
    const assignment = { OR: [{ assignedToId: { in: userIds } }, { assignees: { some: { userId: { in: userIds } } } }] };
    const [sessions, breaks, ticketLogs, meetings, attendanceRows, completedTickets] = await Promise.all([
      this.prisma.workSession.findMany({
        where: { userId: { in: userIds }, date: { gte: range.start, lt: range.end }, startWorkAt: { not: null } },
        select: { userId: true, date: true, startWorkAt: true, logoutAt: true },
      }),
      this.prisma.breakLog.findMany({
        where: { userId: { in: userIds }, breakType: { not: 'MEETING' }, startAt: { lt: range.end }, OR: [{ endAt: null }, { endAt: { gt: range.start } }] },
        select: { userId: true, startAt: true, endAt: true },
      }),
      this.prisma.ticketTimeLog.findMany({
        where: { userId: { in: userIds }, countsAsWork: true, startedAt: { lt: range.end }, OR: [{ endedAt: null }, { endedAt: { gt: range.start } }] },
        select: { userId: true, startedAt: true, endedAt: true },
      }),
      this.prisma.meeting.findMany({
        where: { status: 'COMPLETED', approvalStatus: { in: ['APPROVED', 'NOT_REQUIRED'] }, startedAt: { lt: range.end }, endedAt: { gt: range.start }, participants: { some: { userId: { in: userIds }, status: { in: ['ACCEPTED', 'LEFT'] } } } },
        select: { startedAt: true, endedAt: true, participants: { where: { userId: { in: userIds }, status: { in: ['ACCEPTED', 'LEFT'] } }, select: { userId: true, joinedAt: true, leftAt: true } } },
      }),
      this.prisma.dailyAttendance.findMany({
        where: { userId: { in: userIds }, date: { gte: range.start, lt: range.end } },
        select: { userId: true, status: true, evaluationState: true, lateMinutes: true },
      }),
      this.prisma.ticket.findMany({
        where: {
          AND: [assignment, { status: { in: [TicketStatus.DONE, TicketStatus.CLOSED] } }, {
            OR: [
              { actualCompletedAt: { gte: range.start, lt: range.end } },
              { closedAt: { gte: range.start, lt: range.end } },
              { resolvedAt: { gte: range.start, lt: range.end } },
            ],
          }],
        },
        select: { assignedToId: true, assignees: { select: { userId: true } } },
      }),
    ]);

    const breaksByUser = new Map<string, Interval[]>();
    for (const row of breaks) {
      const interval = clippedInterval(row.startAt, row.endAt, range, now);
      if (interval) breaksByUser.set(row.userId, [...(breaksByUser.get(row.userId) ?? []), interval]);
    }
    const daysByUser = new Map<string, Set<string>>();
    for (const row of sessions) {
      const interval = clippedInterval(row.startWorkAt, row.logoutAt, range, now);
      if (!interval) continue;
      const item = stats.get(row.userId)!;
      item.workingMinutes += netSessionMinutes(interval, breaksByUser.get(row.userId) ?? []);
      const days = daysByUser.get(row.userId) ?? new Set<string>();
      days.add(isoDay(row.date));
      daysByUser.set(row.userId, days);
    }

    const productiveByUser = new Map<string, Interval[]>();
    for (const row of ticketLogs) {
      const interval = clippedInterval(row.startedAt, row.endedAt, range, now);
      if (interval) productiveByUser.set(row.userId, [...(productiveByUser.get(row.userId) ?? []), interval]);
    }
    for (const meeting of meetings) {
      const interval = clippedInterval(meeting.startedAt, meeting.endedAt, range, now);
      if (!interval) continue;
      for (const participant of meeting.participants) if (participant.userId) {
        const own = clippedInterval(participant.joinedAt ?? meeting.startedAt, participant.leftAt ?? meeting.endedAt, range, now);
        if (own) productiveByUser.set(participant.userId, [...(productiveByUser.get(participant.userId) ?? []), own]);
      }
    }
    for (const userId of userIds) {
      const item = stats.get(userId)!;
      item.daysWorked = daysByUser.get(userId)?.size ?? 0;
      item.breakMinutes = unionMinutes(breaksByUser.get(userId) ?? []);
      item.productiveMinutes = unionMinutes(productiveByUser.get(userId) ?? []);
    }
    for (const row of attendanceRows) {
      if (['WEEKLY_OFF', 'HOLIDAY', 'LEAVE', 'LWP'].includes(row.status)) continue;
      const item = stats.get(row.userId)!;
      item.attendanceDays += 1;
      if ((row.status === 'PRESENT' || row.status === 'LATE_EXEMPTED') && row.evaluationState !== 'NEEDS_REVIEW' && (row.status === 'LATE_EXEMPTED' || row.lateMinutes === 0)) item.onTimeDays += 1;
    }
    for (const ticket of completedTickets) {
      const assignees = new Set([ticket.assignedToId, ...ticket.assignees.map((item) => item.userId)].filter(Boolean) as string[]);
      for (const userId of assignees) if (stats.has(userId)) stats.get(userId)!.completedTickets += 1;
    }
    return stats;
  }

  async getPersonalHighlights(viewer: any, month?: string) {
    const role = this.access.roleName(viewer);
    if (!PERSONAL_INSIGHT_ROLES.includes(role)) throw new ForbiddenException('Personal achievements are not available for this role.');
    const { range } = this.resolveRange(month, 'all');
    const monthCursor = new Date(`${range.from.slice(0, 7)}-01T00:00:00.000Z`);
    monthCursor.setUTCMonth(monthCursor.getUTCMonth() - 1);
    const previousMonth = `${monthCursor.getUTCFullYear()}-${String(monthCursor.getUTCMonth() + 1).padStart(2, '0')}`;
    const { range: previousRange } = this.resolveRange(previousMonth, 'all');
    const candidates = await this.prisma.user.findMany({
      where: { isActive: true, isSystemAccount: false, role: { name: { in: PERSONAL_INSIGHT_ROLES } } },
      select: { id: true },
    });
    const candidateIds = [...new Set(candidates.map((item) => item.id))];
    if (!candidateIds.includes(viewer.id)) candidateIds.push(viewer.id);
    const [currentStats, previousStats, projectRows] = await Promise.all([
      this.achievementStats(candidateIds, range),
      this.achievementStats([viewer.id], previousRange),
      this.projects([viewer.id], range),
    ]);
    const own = currentStats.get(viewer.id)!;
    const previous = previousStats.get(viewer.id)!;
    const average = (value: number, days: number) => days ? value / days : 0;
    const ownWorkAverage = average(own.workingMinutes, own.daysWorked);
    const ownProductiveAverage = average(own.productiveMinutes, own.daysWorked);
    const eligible = [...currentStats.values()].filter((item) => item.daysWorked > 0);
    const maxTickets = Math.max(0, ...eligible.map((item) => item.completedTickets));
    const maxWorkAverage = Math.max(0, ...eligible.filter((item) => item.daysWorked >= 3).map((item) => average(item.workingMinutes, item.daysWorked)));
    const maxProductiveAverage = Math.max(0, ...eligible.filter((item) => item.daysWorked >= 3).map((item) => average(item.productiveMinutes, item.daysWorked)));
    const achievements: { id: string; title: string; detail: string; tone: string; kind: string }[] = [];
    if (own.attendanceDays >= 3 && own.onTimeDays === own.attendanceDays) achievements.push({ id: 'punctual', title: 'Perfect Punctuality', detail: `${own.onTimeDays} of ${own.attendanceDays} expected days on time`, tone: 'emerald', kind: 'INDIVIDUAL' });
    if (own.completedTickets > 0 && own.completedTickets === maxTickets) achievements.push({ id: 'ticket-leader', title: 'Monthly Ticket Leader', detail: `${own.completedTickets} ticket${own.completedTickets === 1 ? '' : 's'} completed`, tone: 'blue', kind: 'LEADER' });
    if (own.daysWorked >= 3 && ownWorkAverage > 0 && ownWorkAverage === maxWorkAverage) achievements.push({ id: 'work-leader', title: 'Work Rhythm Leader', detail: `${Math.round(ownWorkAverage)} average working minutes`, tone: 'indigo', kind: 'LEADER' });
    if (own.daysWorked >= 3 && ownProductiveAverage > 0 && ownProductiveAverage === maxProductiveAverage) achievements.push({ id: 'focus-leader', title: 'Focus Leader', detail: `${Math.round(ownProductiveAverage)} productive minutes per day`, tone: 'violet', kind: 'LEADER' });
    if (own.completedTickets > previous.completedTickets) achievements.push({ id: 'ticket-growth', title: 'Personal Ticket Best', detail: `${own.completedTickets - previous.completedTickets} more completed than the previous period`, tone: 'amber', kind: 'PERSONAL_BEST' });
    const previousWorkAverage = average(previous.workingMinutes, previous.daysWorked);
    if (previousWorkAverage > 0 && ownWorkAverage >= previousWorkAverage * 1.05) achievements.push({ id: 'work-growth', title: 'Working Time Improved', detail: `${Math.round((ownWorkAverage / previousWorkAverage - 1) * 100)}% above your previous average`, tone: 'cyan', kind: 'PERSONAL_BEST' });
    const previousProductiveAverage = average(previous.productiveMinutes, previous.daysWorked);
    if (previousProductiveAverage > 0 && ownProductiveAverage >= previousProductiveAverage * 1.05) achievements.push({ id: 'productivity-growth', title: 'Productivity Improved', detail: `${Math.round((ownProductiveAverage / previousProductiveAverage - 1) * 100)}% above your previous average`, tone: 'rose', kind: 'PERSONAL_BEST' });
    return {
      period: { month: range.from.slice(0, 7), from: range.from, to: range.to },
      achievements,
      averageBreakMinutes: own.daysWorked ? Math.round(own.breakMinutes / own.daysWorked) : null,
      projects: projectRows,
    };
  }

  private async direction(userIds: string[], range: Range, overall = false) {
    const buckets: { label: string; from: string; to: string }[] = [];
    if (range.days <= 7) {
      for (let day = range.from; day <= range.to; day = addDays(day, 1)) buckets.push({ label: new Date(`${day}T00:00:00Z`).toLocaleDateString('en', { weekday: 'short' }), from: day, to: day });
    } else {
      for (const week of this.monthWeeks(range.from.slice(0, 7))) {
        if (week.to >= range.from && week.from <= range.to) buckets.push({ label: week.label, from: week.from, to: week.to });
      }
    }
    const today = this.tva.companyToday();
    const values = await Promise.all(buckets.map(async (bucket) => {
      if (bucket.from > today) {
        return { label: bucket.label, minutes: 0, daysWorked: 0, averageMinutes: 0, isFuture: true, isPartial: false };
      }
      const effectiveTo = bucket.to > today ? today : bucket.to;
      const start = this.tva.companyInstantAt(bucket.from, '00:00') as Date;
      const end = this.tva.companyInstantAt(addDays(effectiveTo, 1), '00:00') as Date;
      const metrics = await this.timeMetrics(userIds, { from: bucket.from, to: effectiveTo, start, end, days: Math.round((end.getTime() - start.getTime()) / 86_400_000) }, overall);
      return {
        label: bucket.label,
        minutes: metrics.productiveMinutes,
        daysWorked: metrics.daysWorked,
        averageMinutes: metrics.daysWorked ? Math.round(metrics.productiveMinutes / metrics.daysWorked) : 0,
        isFuture: false,
        isPartial: effectiveTo < bucket.to,
      };
    }));
    return values;
  }

  async getInsights(viewer: any, query: { departmentId?: string; personId?: string; month?: string; week?: string }) {
    const cacheKey = JSON.stringify([
      viewer.id,
      query.departmentId ?? 'all',
      query.personId ?? 'overall',
      query.month ?? this.tva.companyToday().slice(0, 7),
      query.week ?? 'all',
    ]);
    const cached = this.insightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const running = this.insightInFlight.get(cacheKey);
    if (running) return running;

    const calculation = (async () => {
      const revision = await this.dataRevision();
      const latest = this.insightCache.get(cacheKey);
      if (latest?.revision === revision) {
        latest.expiresAt = Date.now() + INSIGHT_CACHE_TTL_MS;
        return latest.value;
      }
      const value = await this.calculateInsights(viewer, query);
      this.insightCache.set(cacheKey, { expiresAt: Date.now() + INSIGHT_CACHE_TTL_MS, revision, value });
      if (this.insightCache.size > 250) {
        for (const [key, entry] of this.insightCache) {
          if (entry.expiresAt <= Date.now()) this.insightCache.delete(key);
        }
        if (this.insightCache.size > 250) {
          const oldestKey = this.insightCache.keys().next().value;
          if (oldestKey) this.insightCache.delete(oldestKey);
        }
      }
      return value;
    })()
      .finally(() => this.insightInFlight.delete(cacheKey));
    this.insightInFlight.set(cacheKey, calculation);
    return calculation;
  }

  private async calculateInsights(viewer: any, query: { departmentId?: string; personId?: string; month?: string; week?: string }) {
    const { range, weeks, mode } = this.resolveRange(query.month, query.week);
    const scope = await this.allowedScope(viewer, query.departmentId);
    const personId = query.personId && query.personId !== 'overall' ? query.personId : null;
    if (personId && !scope.userIds.includes(personId)) throw new ForbiddenException('That person is outside your team-insights scope.');
    const userIds = personId ? [personId] : scope.userIds;
    const overall = !personId;
    const today = this.tva.companyToday();
    const effectiveTo = range.to > today ? today : range.to;
    const hasElapsedDays = range.from <= effectiveTo;
    const effectiveRange: Range = hasElapsedDays ? {
      from: range.from,
      to: effectiveTo,
      start: range.start,
      end: this.tva.companyInstantAt(addDays(effectiveTo, 1), '00:00') as Date,
      days: Math.round(((this.tva.companyInstantAt(addDays(effectiveTo, 1), '00:00') as Date).getTime() - range.start.getTime()) / 86_400_000),
    } : { from: range.from, to: range.from, start: range.start, end: range.start, days: 0 };
    const previousTo = addDays(effectiveRange.from, -1);
    const previousFrom = effectiveRange.days ? addDays(previousTo, -(effectiveRange.days - 1)) : previousTo;
    const previousRange: Range = {
      from: previousFrom, to: previousTo,
      start: this.tva.companyInstantAt(previousFrom, '00:00') as Date,
      end: effectiveRange.days ? this.tva.companyInstantAt(addDays(previousTo, 1), '00:00') as Date : this.tva.companyInstantAt(previousFrom, '00:00') as Date,
      days: effectiveRange.days,
    };
    const companyWide = overall && ['ADMIN', 'SUPER_ADMIN'].includes(scope.role) && !scope.departmentId;
    const [current, previous, tickets, projectRows, trend, identity, attendance] = await Promise.all([
      this.timeMetrics(userIds, effectiveRange, overall),
      this.timeMetrics(userIds, previousRange, overall),
      this.ticketMetrics(userIds, effectiveRange),
      this.projects(userIds, effectiveRange, !companyWide),
      this.direction(userIds, range, overall),
      personId ? this.liveIdentity(personId) : Promise.resolve(null),
      personId ? this.attendance(personId, effectiveRange) : Promise.resolve(null),
    ]);
    const average = (value: number) => current.daysWorked ? Math.round(value / current.daysWorked) : null;
    const meetingDayDivisor = overall ? current.calendarDaysWorked : current.daysWorked;
    const focusRatio = current.workingMinutes ? Math.min(100, Math.round(current.productiveMinutes / current.workingMinutes * 100)) : null;
    const previousRatio = previous.workingMinutes ? Math.min(100, Math.round(previous.productiveMinutes / previous.workingMinutes * 100)) : null;
    const currentDaily = current.daysWorked ? current.productiveMinutes / current.daysWorked : null;
    const previousDaily = previous.daysWorked ? previous.productiveMinutes / previous.daysWorked : null;
    const changePercent = currentDaily != null && previousDaily ? Math.round((currentDaily - previousDaily) / previousDaily * 100) : null;
    return {
      target: personId ? 'PERSON' : 'OVERALL',
      scope: { role: scope.role, people: userIds.length, departmentId: scope.departmentId, companyWide },
      period: { month: range.from.slice(0, 7), mode, week: query.week ?? 'all', from: range.from, to: range.to, dataThrough: hasElapsedDays ? effectiveTo : null, weeks },
      identity,
      focus: { ratio: focusRatio, changePoints: focusRatio != null && previousRatio != null ? focusRatio - previousRatio : null },
      workday: {
        daysWorked: current.daysWorked,
        workingMinutes: current.workingMinutes, productiveMinutes: current.productiveMinutes,
        ticketMinutes: current.ticketMinutes, meetingMinutes: current.meetingMinutes, breakMinutes: current.breakMinutes,
        meetingCount: current.meetingCount,
        averages: {
          workingMinutes: average(current.workingMinutes), productiveMinutes: average(current.productiveMinutes),
          breakMinutes: average(current.breakMinutes), meetingMinutes: average(current.meetingMinutes),
          meetingCount: meetingDayDivisor ? Math.round(current.meetingCount / meetingDayDivisor * 10) / 10 : null,
        },
      },
      productivity: {
        direction: changePercent == null ? 'NO_COMPARISON' : changePercent > 5 ? 'RISING' : changePercent < -5 ? 'FALLING' : 'STEADY',
        changePercent,
        buckets: trend,
      },
      tickets,
      attendance,
      projects: projectRows,
    };
  }
}
