import { BadRequestException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { TVAService } from '../../../common/services/tva.service';
import { LeaveBalanceService } from '../../operations/leave/leave-balance.service';
import { BusinessCalendarService } from '../attendance/calendar/business-calendar.service';

const LEADER_ROLES = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];
const PERSONAL_INSIGHT_ROLES = ['INTERN', 'EMPLOYEE', 'TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];
const ACTIVE_TICKET_STATUSES: TicketStatus[] = [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.REVIEW];
const DATE_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const INSIGHT_CACHE_TTL_MS = 5_000;

type Range = { from: string; to: string; start: Date; end: Date; days: number };
type Interval = { start: number; end: number };

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** WorkSession.date is a PostgreSQL DATE. Query it with UTC calendar dates;
 * company-time instants remain responsible for clipping elapsed time. */
function databaseDay(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

function addDays(day: string, amount: number) {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return isoDay(value);
}

function clockMinute(date: Date, timezone: string) {
  const [hour, minute] = formatInTimeZone(date, timezone, 'HH:mm').split(':').map(Number);
  return hour * 60 + minute;
}

export function averageClockMinute(values: number[]) {
  if (!values.length) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
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

function ticketStatusAt(ticket: any, instant: Date): TicketStatus | null {
  if (ticket.createdAt >= instant) return null;
  const history = [...(ticket.history ?? [])]
    .filter((entry: any) => entry.field === 'status')
    .sort((a: any, b: any) => a.changedAt.getTime() - b.changedAt.getTime());
  if (history.length) {
    let status = (history[0].oldValue ?? TicketStatus.OPEN) as TicketStatus;
    for (const entry of history) {
      if (entry.changedAt >= instant) break;
      status = entry.newValue as TicketStatus;
    }
    return status;
  }
  const completedAt = ticket.closedAt ?? ticket.resolvedAt ?? ticket.actualCompletedAt ?? ticket.cancelledAt ?? null;
  if (completedAt && completedAt < instant) return ticket.status;
  const reviewAt = ticket.reviewStartedAt ?? ticket.submittedAt ?? null;
  if (reviewAt && reviewAt < instant) return TicketStatus.REVIEW;
  if (ticket.actualStartAt && ticket.actualStartAt < instant) return TicketStatus.IN_PROGRESS;
  return TicketStatus.OPEN;
}

function ticketCompletionAt(ticket: any): Date | null {
  const milestone = ticket.closedAt ?? ticket.resolvedAt ?? ticket.actualCompletedAt ?? null;
  if (milestone) return milestone;
  const transition = [...(ticket.history ?? [])]
    .filter((entry: any) => entry.field === 'status' && ['DONE', 'CLOSED'].includes(entry.newValue))
    .sort((a: any, b: any) => a.changedAt.getTime() - b.changedAt.getTime())[0];
  return transition?.changedAt ?? null;
}

export function ticketOverduePhase(ticket: any, asOf: Date): 'EXECUTION' | 'REVIEW' | null {
  const completedAt = ticketCompletionAt(ticket);
  if (completedAt && completedAt <= asOf) return null;
  const status = ticketStatusAt(ticket, asOf);
  if (status === TicketStatus.REVIEW) {
    const due = ticket.reviewDueAt ?? ticket.dueDate;
    return due && due < asOf ? 'REVIEW' : null;
  }
  if (status === TicketStatus.OPEN || status === TicketStatus.IN_PROGRESS) {
    const due = ticket.executionDueAt ?? ticket.dueDate;
    return due && due < asOf ? 'EXECUTION' : null;
  }
  return null;
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
    @Optional() private readonly businessCalendar?: BusinessCalendarService,
    @Optional() private readonly leaveBalanceService?: LeaveBalanceService,
  ) {}

  private async scheduledDates(range: Range) {
    if (!range.days || range.from > range.to) return { dates: [] as string[], calendarDays: [] as any[], calendarResolved: true };
    if (!this.businessCalendar) {
      // Unit-test compatibility only. The application module always supplies
      // BusinessCalendarService, which is the authority for these dates.
      const dates: string[] = [];
      const calendarDays: Array<{ businessDate: string; isWorkingDay: boolean; reason: string; holidayName: null }> = [];
      for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
        const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
        const isWorkingDay = weekday !== 0;
        if (isWorkingDay) dates.push(day);
        calendarDays.push({ businessDate: day, isWorkingDay, reason: isWorkingDay ? 'WORKING' : 'SUNDAY', holidayName: null });
      }
      return { dates, calendarDays, calendarResolved: false };
    }
    const months = [...new Set([range.from.slice(0, 7), range.to.slice(0, 7)])];
    const classified = await Promise.all(months.map((key) => {
      const [year, month] = key.split('-').map(Number);
      return this.businessCalendar!.classifyMonth(year, month);
    }));
    const calendarDays = classified.flatMap((month) => month.days)
      .filter((day) => day.businessDate >= range.from && day.businessDate <= range.to);
    return {
      dates: calendarDays.filter((day) => day.isWorkingDay).map((day) => day.businessDate),
      calendarDays,
      calendarResolved: classified.every((month) =>
        month.sources.holidayCalendar !== 'NONE' && month.sources.holidayCalendar !== 'AMBIGUOUS'
        && month.sources.weeklyOffPolicy !== 'NONE' && month.sources.weeklyOffPolicy !== 'AMBIGUOUS'),
    };
  }

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
   * A cheap global change token for the workday tables used by Team Insights. Once a
   * cached answer is a few seconds old, refresh checks these MAX timestamps.
   * If they are unchanged, the verified answer is reused and none of the
   * expensive analytics queries run again.
   */
  private async dataRevision() {
    const revisions = await Promise.all([
      this.prisma.user.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.workSession.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.breakLog.aggregate({ _count: { _all: true }, _max: { createdAt: true, endAt: true } }),
      this.prisma.ticketTimeLog.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.ticket?.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }) ?? Promise.resolve({ _count: { _all: 0 }, _max: {} }),
      this.prisma.project?.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }) ?? Promise.resolve({ _count: { _all: 0 }, _max: {} }),
      this.prisma.ticketHistory?.aggregate({ _count: { _all: true }, _max: { changedAt: true } }) ?? Promise.resolve({ _count: { _all: 0 }, _max: {} }),
      this.prisma.reviewCycleLog?.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }) ?? Promise.resolve({ _count: { _all: 0 }, _max: {} }),
      this.prisma.meeting.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.dailyAttendance.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.leaveRequest?.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }) ?? Promise.resolve({ _count: { _all: 0 }, _max: {} }),
      this.prisma.holiday?.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }) ?? Promise.resolve({ _count: { _all: 0 }, _max: {} }),
      this.prisma.weeklyOffPolicy?.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }) ?? Promise.resolve({ _count: { _all: 0 }, _max: {} }),
      this.prisma.businessDayOverride?.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }) ?? Promise.resolve({ _count: { _all: 0 }, _max: {} }),
    ]);
    return JSON.stringify(revisions.map((entry) => [
      entry._count._all,
      ...Object.values(entry._max).map((value) => value instanceof Date ? value.getTime() : value),
    ]));
  }

  private resolveRange(month?: string, week?: string, date?: string): { range: Range; weeks: ReturnType<TeamInsightsService['monthWeeks']>; mode: 'MONTH' | 'WEEK' | 'DAY' } {
    if (date) {
      if (!DAY_RE.test(date) || isoDay(new Date(`${date}T00:00:00.000Z`)) !== date) throw new BadRequestException('date must be a valid YYYY-MM-DD date');
      const start = this.tva.companyInstantAt(date, '00:00') as Date;
      const end = this.tva.companyInstantAt(addDays(date, 1), '00:00') as Date;
      return { weeks: this.monthWeeks(date.slice(0, 7)), mode: 'DAY', range: { from: date, to: date, start, end, days: 1 } };
    }
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

  private async scheduledEmployeeDays(userIds: string[], scheduledDates: string[]) {
    const maximumEmployeeDays = userIds.length * scheduledDates.length;
    if (!userIds.length || !scheduledDates.length) {
      return {
        eligible: new Set<string>(), expectedEmployeeDays: 0,
        employmentExcludedDays: maximumEmployeeDays, unresolvedScheduleDays: 0,
      };
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, joiningDate: true, lastWorkingDate: true },
    });
    const timezone = this.tva.companyTimezone();
    const periodStart = this.tva.companyInstantAt(scheduledDates[0], '00:00') as Date;
    const periodEndExclusive = this.tva.companyInstantAt(addDays(scheduledDates[scheduledDates.length - 1], 1), '00:00') as Date;
    const profiles = await this.prisma.employeeAttendanceProfile.findMany({
      where: {
        userId: { in: userIds },
        effectiveFrom: { lt: periodEndExclusive },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
      },
      select: { userId: true, attendanceRequired: true, category: true, effectiveFrom: true, effectiveTo: true },
      orderBy: { effectiveFrom: 'asc' },
    });
    const profilesByUser = new Map<string, typeof profiles>();
    for (const profile of profiles) {
      profilesByUser.set(profile.userId, [...(profilesByUser.get(profile.userId) ?? []), profile]);
    }
    const eligible = new Set<string>();
    let employmentExcludedDays = 0;
    let unresolvedScheduleDays = 0;
    for (const user of users) {
      const joined = user.joiningDate ? formatInTimeZone(user.joiningDate, timezone, 'yyyy-MM-dd') : null;
      const left = user.lastWorkingDate ? formatInTimeZone(user.lastWorkingDate, timezone, 'yyyy-MM-dd') : null;
      for (const date of scheduledDates) {
        if ((joined && date < joined) || (left && date > left)) {
          employmentExcludedDays += 1;
          continue;
        }
        if (joined) {
          eligible.add(`${user.id}:${date}`);
          continue;
        }

        // Legacy employees may not have a joining date. Their attendance
        // profile effective window is a real tracking fact and is therefore a
        // safe lower bound; no profile means the denominator is unresolved,
        // never silently assumed or guessed.
        const profile = (profilesByUser.get(user.id) ?? []).find((item) => {
          const from = formatInTimeZone(item.effectiveFrom, timezone, 'yyyy-MM-dd');
          const to = item.effectiveTo ? formatInTimeZone(item.effectiveTo, timezone, 'yyyy-MM-dd') : null;
          return date >= from && (!to || date <= to);
        });
        if (profile && profile.attendanceRequired && profile.category !== 'MANAGEMENT_EXEMPT') {
          eligible.add(`${user.id}:${date}`);
        } else if (profile) {
          employmentExcludedDays += 1;
        } else {
          unresolvedScheduleDays += 1;
        }
      }
    }
    // A user disappearing between the authorized scope query and this query is
    // an unresolved schedule, not zero attendance and not an employment exit.
    unresolvedScheduleDays += Math.max(0, userIds.length - users.length) * scheduledDates.length;
    return {
      eligible,
      expectedEmployeeDays: eligible.size,
      employmentExcludedDays,
      unresolvedScheduleDays,
    };
  }

  private async timeMetrics(userIds: string[], range: Range, overall = false, scheduledDates?: string[], eligibleEmployeeDays?: Set<string>) {
    if (!userIds.length) return {
      workingMinutes: 0, presenceMinutes: 0, breakMinutes: 0, breakCount: 0, ticketMinutes: 0, meetingMinutes: 0,
      productiveMinutes: 0, meetingCount: 0, meetingParticipationCount: 0,
      punchInMinute: null, punchOutMinute: null, punchInCount: 0, punchOutCount: 0,
      measurablePresenceDays: 0, daysWorked: 0, calendarDaysWorked: 0,
    };
    const now = this.tva.now();
    const allowedDates = scheduledDates ? new Set(scheduledDates) : null;
    const metricRanges = scheduledDates
      ? scheduledDates.map((day) => ({
          from: day, to: day,
          start: this.tva.companyInstantAt(day, '00:00') as Date,
          end: this.tva.companyInstantAt(addDays(day, 1), '00:00') as Date,
          days: 1,
        }))
      : [range];
    const clipToWorkingDays = (userId: string, start: Date | null | undefined, end: Date | null | undefined) =>
      metricRanges
        .filter((metricRange) => !eligibleEmployeeDays || eligibleEmployeeDays.has(`${userId}:${metricRange.from}`))
        .map((metricRange) => clippedInterval(start, end, metricRange, now)).filter((item): item is Interval => !!item);
    const [sessions, attendanceRows, breaks, ticketLogs, meetings] = await Promise.all([
      this.prisma.workSession.findMany({
        where: {
          userId: { in: userIds },
          date: { gte: databaseDay(range.from), lte: databaseDay(range.to) },
          startWorkAt: { not: null },
        },
        select: { id: true, userId: true, date: true, startWorkAt: true, logoutAt: true },
      }),
      this.prisma.dailyAttendance.findMany({
        where: {
          userId: { in: userIds },
          date: { gte: databaseDay(range.from), lte: databaseDay(range.to) },
          OR: [{ punchInAt: { not: null } }, { punchOutAt: { not: null } }],
        },
        select: { userId: true, date: true, punchInAt: true, punchOutAt: true },
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
    let breakCount = 0;
    for (const row of breaks) {
      if (row.breakType === 'MEETING') continue;
      // An open break is temporarily clipped to `now`. This keeps live working
      // time honest without completing or otherwise mutating the stored break.
      const intervals = clipToWorkingDays(row.userId, row.startAt, row.endAt);
      if (!intervals.length) continue;
      // Counts remain finalized facts; elapsed live break time is still
      // included in break minutes and deducted from live working minutes.
      if (row.endAt) breakCount += 1;
      breaksByUser.set(row.userId, [...(breaksByUser.get(row.userId) ?? []), ...intervals]);
    }
    let workingMinutes = 0;
    const workedDays = new Set<string>();
    const punchesByEmployeeDay = new Map<string, { punchIn: Date | null; punchOut: Date | null }>();
    for (const session of sessions) {
      const sessionDay = isoDay(session.date);
      if (allowedDates && !allowedDates.has(sessionDay)) continue;
      const employeeDay = `${session.userId}:${sessionDay}`;
      if (eligibleEmployeeDays && !eligibleEmployeeDays.has(employeeDay)) continue;
      const punch = punchesByEmployeeDay.get(employeeDay) ?? { punchIn: null, punchOut: null };
      if (session.startWorkAt && (!punch.punchIn || session.startWorkAt < punch.punchIn)) punch.punchIn = session.startWorkAt;
      if (session.logoutAt && (!punch.punchOut || session.logoutAt > punch.punchOut)) punch.punchOut = session.logoutAt;
      punchesByEmployeeDay.set(employeeDay, punch);
      const intervals = clipToWorkingDays(session.userId, session.startWorkAt, session.logoutAt);
      if (!intervals.length) continue;
      workingMinutes += intervals.reduce((sum, interval) => sum + netSessionMinutes(interval, breaksByUser.get(session.userId) ?? []), 0);
      workedDays.add(`${session.userId}:${isoDay(session.date)}`);
    }
    // Finalized attendance is authoritative for corrected punches. Session-derived
    // values remain as a live fallback for today before evaluation completes.
    for (const row of attendanceRows) {
      const sessionDay = isoDay(row.date);
      if (allowedDates && !allowedDates.has(sessionDay)) continue;
      const employeeDay = `${row.userId}:${sessionDay}`;
      if (eligibleEmployeeDays && !eligibleEmployeeDays.has(employeeDay)) continue;
      const punch = punchesByEmployeeDay.get(employeeDay) ?? { punchIn: null, punchOut: null };
      if (row.punchInAt) punch.punchIn = row.punchInAt;
      if (row.punchOutAt) punch.punchOut = row.punchOutAt;
      punchesByEmployeeDay.set(employeeDay, punch);
    }
    const ticketByUser = new Map<string, Interval[]>();
    for (const row of ticketLogs) {
      const intervals = clipToWorkingDays(row.userId, row.startedAt, row.endedAt);
      if (intervals.length) ticketByUser.set(row.userId, [...(ticketByUser.get(row.userId) ?? []), ...intervals]);
    }
    const meetingByUser = new Map<string, Interval[]>();
    let meetingCount = 0;
    let meetingParticipationCount = 0;
    for (const meeting of meetings) {
      const intervals = metricRanges.map((metricRange) => clippedInterval(meeting.startedAt, meeting.endedAt, metricRange, now)).filter((item): item is Interval => !!item);
      if (!intervals.length) continue;
      // A shared meeting with five scoped participants is one meeting, not five.
      meetingCount += 1;
      for (const participant of meeting.participants) {
        if (!participant.userId) continue;
        const own = clipToWorkingDays(participant.userId, participant.joinedAt ?? meeting.startedAt, participant.leftAt ?? meeting.endedAt);
        if (own.length) {
          meetingParticipationCount += 1;
          meetingByUser.set(participant.userId, [...(meetingByUser.get(participant.userId) ?? []), ...own]);
        }
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
    const timezone = this.tva.companyTimezone();
    const punchIns = [...punchesByEmployeeDay.values()].flatMap((punch) => punch.punchIn ? [clockMinute(punch.punchIn, timezone)] : []);
    const punchOuts = [...punchesByEmployeeDay.values()].flatMap((punch) => punch.punchOut ? [clockMinute(punch.punchOut, timezone)] : []);
    let presenceMinutes = 0;
    let measurablePresenceDays = 0;
    for (const [employeeDay, punch] of punchesByEmployeeDay) {
      if (!punch.punchIn || !punch.punchOut || punch.punchOut <= punch.punchIn) continue;
      const userId = employeeDay.slice(0, employeeDay.indexOf(':'));
      const intervals = clipToWorkingDays(userId, punch.punchIn, punch.punchOut);
      if (!intervals.length) continue;
      presenceMinutes += unionMinutes(intervals);
      measurablePresenceDays += 1;
    }
    return {
      workingMinutes, presenceMinutes, breakMinutes, breakCount, ticketMinutes, meetingMinutes, productiveMinutes,
      meetingCount, meetingParticipationCount,
      punchInMinute: averageClockMinute(punchIns), punchOutMinute: averageClockMinute(punchOuts),
      punchInCount: punchIns.length, punchOutCount: punchOuts.length,
      measurablePresenceDays, daysWorked: workedDays.size, calendarDaysWorked,
    };
  }

  private async attendanceMetrics(userIds: string[], scheduledDates: string[], eligibleEmployeeDays: Set<string>, employmentExcludedDays: number) {
    const expectedEmployeeDays = eligibleEmployeeDays.size;
    if (!userIds.length || !scheduledDates.length) return {
      scheduledWorkingDays: scheduledDates.length, expectedEmployeeDays, presentDays: 0,
      halfDays: 0, lateDays: 0, lessWorkingHoursDays: 0, absentDays: 0, leaveDays: 0, unresolvedDays: 0, missingDays: expectedEmployeeDays,
      attendanceRate: null, coverageRate: expectedEmployeeDays ? 0 : null, employmentExcludedDays,
    };
    const dateSet = new Set(scheduledDates);
    const rows = await this.prisma.dailyAttendance.findMany({
      where: {
        userId: { in: userIds },
        date: { gte: databaseDay(scheduledDates[0]), lte: databaseDay(scheduledDates[scheduledDates.length - 1]) },
      },
      select: { userId: true, date: true, status: true, evaluationState: true, exceptionFlags: true },
    });
    const applicable = rows.filter((row) => {
      const date = isoDay(row.date);
      return dateSet.has(date) && eligibleEmployeeDays.has(`${row.userId}:${date}`);
    });
    const fullDayPresentStatuses = new Set(['PRESENT', 'LATE', 'LATE_EXEMPTED']);
    // "Present days" is intentionally inclusive: a half day, late day or
    // short-hours day still means the employee attended. Attendance rate keeps
    // its separate half-day weighting below.
    const attendedStatuses = new Set([...fullDayPresentStatuses, 'HALF_DAY']);
    // Outcome buckets are mutually exclusive. A day under review is not also
    // advertised as verified present/half-day/absent/leave.
    const resolved = applicable.filter((row) => row.evaluationState !== 'NEEDS_REVIEW');
    const presentDays = resolved.filter((row) => attendedStatuses.has(row.status)).length;
    const halfDays = resolved.filter((row) => row.status === 'HALF_DAY').length;
    const lateDays = resolved.filter((row) => row.status === 'LATE').length;
    const lessWorkingHoursDays = resolved.filter((row) => (row.exceptionFlags ?? []).some((flag) =>
      flag === 'INSUFFICIENT_PRESENCE_SPAN' || flag === 'INSUFFICIENT_EFFECTIVE_WORK',
    )).length;
    const absentDays = resolved.filter((row) => row.status === 'ABSENT').length;
    const leaveDays = resolved.filter((row) => row.status === 'LEAVE' || row.status === 'LWP').length;
    const unresolvedDays = applicable.filter((row) => row.evaluationState === 'NEEDS_REVIEW').length;
    const uniqueEvaluated = new Set(applicable.map((row) => `${row.userId}:${isoDay(row.date)}`)).size;
    const missingDays = Math.max(0, expectedEmployeeDays - uniqueEvaluated);
    // Never turn an unevaluated or under-review day into an absence. The rate
    // uses only verified attendance outcomes; completeness reports how much of
    // the scheduled population is trustworthy enough to analyse.
    const resolvedPresent = resolved.filter((row) => fullDayPresentStatuses.has(row.status)).length;
    const resolvedHalfDays = resolved.filter((row) => row.status === 'HALF_DAY').length;
    // Every employment-eligible company working day stays in the denominator:
    // absence, leave, half-day and missing data do not silently disappear.
    const coverageRate = expectedEmployeeDays ? Math.round(((uniqueEvaluated - unresolvedDays) / expectedEmployeeDays) * 1000) / 10 : null;
    const attendanceRate = expectedEmployeeDays && missingDays === 0 && unresolvedDays === 0
      ? Math.round(((resolvedPresent + resolvedHalfDays * 0.5) / expectedEmployeeDays) * 1000) / 10
      : null;
    return { scheduledWorkingDays: scheduledDates.length, expectedEmployeeDays, employmentExcludedDays, presentDays, halfDays, lateDays, lessWorkingHoursDays, absentDays, leaveDays, unresolvedDays, missingDays, attendanceRate, coverageRate };
  }

  private async personalAttendanceCalendar(
    userId: string,
    range: Range,
    calendarDays: Array<{ businessDate: string; isWorkingDay: boolean; reason: string; holidayName: string | null }>,
  ) {
    const [rows, sessions, breaks, ticketLogs, meetings, approvedLeaves] = await Promise.all([
      this.prisma.dailyAttendance.findMany({
        where: { userId, date: { gte: databaseDay(range.from), lte: databaseDay(range.to) } },
        select: {
          date: true, status: true, evaluationState: true, exceptionFlags: true,
          workedMinutes: true, breakMinutes: true, lateMinutes: true, punchInAt: true, punchOutAt: true,
        },
      }),
      this.prisma.workSession.findMany({
        where: { userId, date: { gte: databaseDay(range.from), lte: databaseDay(range.to) }, startWorkAt: { not: null } },
        select: { id: true, date: true, startWorkAt: true, logoutAt: true, status: true },
        orderBy: { startWorkAt: 'asc' },
      }),
      this.prisma.breakLog.findMany({
        where: { userId, startAt: { lt: range.end }, OR: [{ endAt: null }, { endAt: { gt: range.start } }] },
        select: { id: true, breakType: true, startAt: true, endAt: true },
      }),
      this.prisma.ticketTimeLog.findMany({
        where: { userId, countsAsWork: true, startedAt: { lt: range.end }, OR: [{ endedAt: null }, { endedAt: { gt: range.start } }] },
        select: { startedAt: true, endedAt: true },
      }),
      this.prisma.meeting.findMany({
        where: {
          status: 'COMPLETED', approvalStatus: { in: ['APPROVED', 'NOT_REQUIRED'] },
          startedAt: { lt: range.end }, endedAt: { gt: range.start },
          participants: { some: { userId, status: { in: ['ACCEPTED', 'LEFT'] } } },
        },
        select: {
          startedAt: true, endedAt: true,
          participants: { where: { userId, status: { in: ['ACCEPTED', 'LEFT'] } }, select: { joinedAt: true, leftAt: true } },
        },
      }),
      this.prisma.leaveRequest?.findMany ? this.prisma.leaveRequest.findMany({
        where: {
          userId,
          status: 'APPROVED',
          startDate: { lt: range.end },
          endDate: { gte: range.start },
        },
        select: { id: true, type: true, startDate: true, endDate: true, isHalfDay: true },
        orderBy: { startDate: 'asc' },
      }) : Promise.resolve([]),
    ]);
    const rowsByDate = new Map(rows.map((row) => [isoDay(row.date), row]));
    const today = this.tva.companyToday();
    const now = this.tva.now();
    const productiveDates = new Set<string>();
    for (const day of calendarDays) {
      if (!day.isWorkingDay) continue;
      const dayStart = this.tva.companyInstantAt(day.businessDate, '00:00') as Date;
      const dayEnd = this.tva.companyInstantAt(addDays(day.businessDate, 1), '00:00') as Date;
      const hasTicketWork = ticketLogs.some((log) => log.startedAt < dayEnd && (log.endedAt ?? now) > dayStart);
      const hasValidatedMeeting = meetings.some((meeting) => meeting.participants.some((participant) => {
        const joinedAt = participant.joinedAt ?? meeting.startedAt;
        const leftAt = participant.leftAt ?? meeting.endedAt;
        return joinedAt < dayEnd && leftAt > dayStart;
      }));
      if (hasTicketWork || hasValidatedMeeting) productiveDates.add(day.businessDate);
    }
    return calendarDays.map((day) => {
      const row = rowsByDate.get(day.businessDate);
      const dayRange: Range = {
        from: day.businessDate,
        to: day.businessDate,
        start: this.tva.companyInstantAt(day.businessDate, '00:00') as Date,
        end: this.tva.companyInstantAt(addDays(day.businessDate, 1), '00:00') as Date,
        days: 1,
      };
      const daySessions = sessions.filter((session) => isoDay(session.date) === day.businessDate);
      const dayBreakRows = breaks.filter((item) => !!clippedInterval(item.startAt, item.endAt, dayRange, now));
      const nonMeetingBreaks = dayBreakRows.filter((item) => item.breakType !== 'MEETING');
      const breakIntervals = nonMeetingBreaks
        .map((item) => clippedInterval(item.startAt, item.endAt, dayRange, now))
        .filter((item): item is Interval => !!item);
      const sessionIntervals = daySessions
        .map((session) => clippedInterval(session.startWorkAt, session.logoutAt, dayRange, now))
        .filter((item): item is Interval => !!item);
      const derivedWorkingMinutes = sessionIntervals.reduce((sum, interval) => sum + netSessionMinutes(interval, breakIntervals), 0);
      const ticketIntervals = ticketLogs
        .map((log) => clippedInterval(log.startedAt, log.endedAt, dayRange, now))
        .filter((item): item is Interval => !!item);
      const meetingIntervals: Interval[] = [];
      let meetingCount = 0;
      for (const meeting of meetings) {
        const participantIntervals = meeting.participants
          .map((participant) => clippedInterval(participant.joinedAt ?? meeting.startedAt, participant.leftAt ?? meeting.endedAt, dayRange, now))
          .filter((item): item is Interval => !!item);
        if (participantIntervals.length) {
          meetingCount += 1;
          meetingIntervals.push(...participantIntervals);
        }
      }
      const sessionPunchIns = daySessions.flatMap((session) => session.startWorkAt ? [session.startWorkAt] : []);
      const sessionPunchOuts = daySessions.flatMap((session) => session.logoutAt ? [session.logoutAt] : []);
      const punchInAt = row?.punchInAt ?? (sessionPunchIns.length ? new Date(Math.min(...sessionPunchIns.map((value) => value.getTime()))) : null);
      const punchOutAt = row?.punchOutAt ?? (sessionPunchOuts.length ? new Date(Math.max(...sessionPunchOuts.map((value) => value.getTime()))) : null);
      const approvedLeave = approvedLeaves.find((leave) =>
        leave.startDate < dayRange.end && leave.endDate >= dayRange.start,
      );
      const openSession = day.businessDate === today ? daySessions.find((session) => !session.logoutAt) : null;
      const openBreak = day.businessDate === today ? dayBreakRows.find((item) => !item.endAt) : null;
      const currentStatus = day.businessDate !== today ? null
        : openBreak?.breakType === 'MEETING' ? 'IN_MEETING'
          : openBreak ? 'ON_BREAK'
            : openSession?.status ?? (punchOutAt ? 'DAY_COMPLETED' : 'NOT_STARTED');
      const isShortHours = row?.exceptionFlags?.some((flag) =>
        flag === 'INSUFFICIENT_PRESENCE_SPAN' || flag === 'INSUFFICIENT_EFFECTIVE_WORK',
      );
      // An approved leave request is a calendar fact even before the nightly
      // attendance evaluator materialises a DailyAttendance row. Conversely,
      // a real punch-in wins over a stale historical LEAVE row after the
      // workday transaction has auto-cancelled the request.
      const storedOutcome = row?.status ?? null;
      const outcome = approvedLeave && !punchInAt
        ? 'LEAVE'
        : punchInAt && (storedOutcome === 'LEAVE' || storedOutcome === 'LWP')
          ? null
          : storedOutcome;
      const isResolved = (!!row && row.evaluationState !== 'NEEDS_REVIEW') || (!!approvedLeave && !punchInAt);
      const isPresent = isResolved && ['PRESENT', 'LATE', 'LATE_EXEMPTED', 'HALF_DAY'].includes(outcome ?? '');
      const isProductive = isPresent && productiveDates.has(day.businessDate);
      const isOvertime = isPresent && (row?.workedMinutes ?? 0) > 540;
      const modifiers = [
        outcome === 'LATE' ? 'LATE' : null,
        outcome === 'LATE_EXEMPTED' ? 'LATE_EXEMPTED' : null,
        isShortHours ? 'SHORT_HOURS' : null,
        isProductive ? 'PRODUCTIVE' : null,
        isOvertime ? 'OVERTIME' : null,
      ].filter((value): value is string => !!value);
      const attendanceStatus = row?.evaluationState === 'NEEDS_REVIEW'
        ? 'NEEDS_REVIEW'
        : outcome === 'HALF_DAY' ? 'HALF_DAY'
          : isOvertime ? 'OVERTIME'
            : isShortHours ? 'SHORT_HOURS'
              : isProductive ? 'PRODUCTIVE'
                : outcome;
      const knownAttendanceStatuses = new Set(['PRESENT', 'PRODUCTIVE', 'OVERTIME', 'SHORT_HOURS', 'LATE', 'LATE_EXEMPTED', 'HALF_DAY', 'LEAVE', 'LWP', 'ABSENT', 'HOLIDAY', 'WEEKLY_OFF']);
      const displayStatus = (row && attendanceStatus && !knownAttendanceStatuses.has(attendanceStatus) ? 'NEEDS_REVIEW' : attendanceStatus)
        ?? (punchInAt ? (day.businessDate === today && !punchOutAt ? 'IN_PROGRESS' : 'NEEDS_REVIEW')
          : day.reason === 'HOLIDAY' || day.reason === 'COMPANY_CLOSURE' ? 'HOLIDAY'
          : ['SUNDAY', 'SECOND_SATURDAY', 'FOURTH_SATURDAY'].includes(day.reason) ? 'WEEKLY_OFF'
            : day.businessDate > today ? 'FUTURE' : 'MISSING');
      return {
        date: day.businessDate,
        status: displayStatus,
        outcome,
        modifiers,
        isPresent,
        holidayName: day.holidayName,
        isWorkingDay: day.isWorkingDay,
        punchInAt: punchInAt?.toISOString() ?? null,
        punchOutAt: punchOutAt?.toISOString() ?? null,
        workingMinutes: sessionIntervals.length ? derivedWorkingMinutes : row?.workedMinutes ?? null,
        productiveMinutes: unionMinutes([...ticketIntervals, ...meetingIntervals]),
        meetingMinutes: unionMinutes(meetingIntervals),
        meetingCount,
        breakCount: nonMeetingBreaks.length,
        breakMinutes: breakIntervals.length ? unionMinutes(breakIntervals) : row?.breakMinutes ?? 0,
        lateMinutes: row?.lateMinutes ?? 0,
        currentStatus,
        leaveType: approvedLeave && !punchInAt ? approvedLeave.type : null,
      };
    });
  }

  private async personalLeaveUsage(userId: string, asOf: Date) {
    if (!this.leaveBalanceService) return null;
    const financialYear = this.tva.financialYear(asOf);
    const bounds = this.tva.financialYearBounds(financialYear);
    const [balance, approvedLeaves] = await Promise.all([
      this.leaveBalanceService.getLeaveBalance(userId, financialYear.startYear, undefined, asOf),
      this.prisma.leaveRequest.findMany({
        where: {
          userId,
          status: 'APPROVED',
          startDate: {
            gte: this.tva.companyDayStart(bounds.start),
            lte: this.tva.companyDayEnd(bounds.end),
          },
        },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, type: true, startDate: true, endDate: true, isHalfDay: true },
      }),
    ]);
    return {
      allocatedDays: balance.allocation,
      takenDays: balance.approved,
      pendingDays: balance.pending,
      financialYear: financialYear.label,
      leaves: approvedLeaves.map((leave) => ({
        id: leave.id,
        type: leave.type,
        startDate: isoDay(leave.startDate),
        endDate: isoDay(leave.endDate),
        isHalfDay: leave.isHalfDay,
      })),
    };
  }

  private async liveIdentity(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, photoUrl: true, avatar: true, currentStatus: true, role: { select: { name: true } }, department: { select: { id: true, name: true } } },
    });
    if (!user) throw new BadRequestException('The selected person is unavailable.');
    const todayString = this.tva.companyToday();
    const today = this.tva.companyInstantAt(todayString, '00:00') as Date;
    const session = await this.prisma.workSession.findFirst({
      where: { userId, date: databaseDay(todayString), logoutAt: null },
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
    if (!userIds.length) return { active: 0, inProgress: 0, underReview: 0, completed: 0, overdue: 0, sentForReview: 0, executionOverdue: 0, reviewOverdue: 0, reworkTickets: 0, reworkAttempts: 0 };
    const assignment = { OR: [{ assignedToId: { in: userIds } }, { assignees: { some: { userId: { in: userIds } } } }] };
    const [tickets, reviewStarts, reworks] = await Promise.all([
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
    ]);
    const executionOverdueIds = new Set<string>();
    const reviewOverdueIds = new Set<string>();
    const asOf = new Date(Math.min(range.end.getTime(), this.tva.now().getTime()));
    for (const ticket of tickets) {
      const overduePhase = ticketOverduePhase(ticket, asOf);
      if (overduePhase === 'EXECUTION') executionOverdueIds.add(ticket.id);
      if (overduePhase === 'REVIEW') reviewOverdueIds.add(ticket.id);
    }
    const activeInPeriod = tickets.filter((ticket) => ACTIVE_TICKET_STATUSES.some((status) => ticketHadStatus(ticket, status, range)));
    return {
      active: activeInPeriod.length,
      inProgress: tickets.filter((ticket) => ticketHadStatus(ticket, TicketStatus.IN_PROGRESS, range)).length,
      underReview: tickets.filter((ticket) => ticketHadStatus(ticket, TicketStatus.REVIEW, range)).length,
      completed: tickets.filter((ticket) => {
        const completedAt = ticketCompletionAt(ticket);
        return completedAt && completedAt >= range.start && completedAt < range.end;
      }).length,
      overdue: new Set([...executionOverdueIds, ...reviewOverdueIds]).size,
      sentForReview: new Set(reviewStarts.map((row) => row.ticketId)).size,
      executionOverdue: executionOverdueIds.size,
      reviewOverdue: reviewOverdueIds.size,
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
        department: { select: { id: true, name: true } },
        tickets: { select: {
          id: true, status: true, assignedToId: true, dueDate: true, executionDueAt: true, reviewDueAt: true,
          createdAt: true, updatedAt: true, actualStartAt: true, actualCompletedAt: true, submittedAt: true,
          reviewStartedAt: true, closedAt: true, resolvedAt: true, cancelledAt: true,
          department: { select: { id: true, name: true } },
          assignees: { select: { userId: true } },
          history: { where: { field: 'status' }, orderBy: { changedAt: 'asc' } },
        } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    });
    const now = this.tva.now();
    const asOf = new Date(Math.min(range.end.getTime(), now.getTime()));
    return projects.map((project) => {
      const inPeriod = (ticket: any) => activeTicketIds.has(ticket.id)
        || ACTIVE_TICKET_STATUSES.some((status) => ticketHadStatus(ticket, status, range))
        || (() => { const completedAt = ticketCompletionAt(ticket); return completedAt && completedAt >= range.start && completedAt < range.end; })();
      const mine = project.tickets.filter((ticket) => assignment(ticket) && inPeriod(ticket));
      const completedInPeriod = (ticket: any) => {
        const completedAt = ticketCompletionAt(ticket);
        return completedAt && completedAt >= range.start && completedAt < range.end;
      };
      const done = mine.filter(completedInPeriod).length;
      const active = mine.filter((ticket) => {
        const status = ticketStatusAt(ticket, asOf);
        return status != null && ACTIVE_TICKET_STATUSES.includes(status);
      }).length;
      const overdue = mine.filter((ticket) => {
        return ticketOverduePhase(ticket, asOf) != null;
      }).length;
      const allDone = project.tickets.filter((ticket) => inPeriod(ticket) && completedInPeriod(ticket)).length;
      const inferredDepartments = [...new Map(project.tickets
        .flatMap((ticket) => ticket.department ? [[ticket.department.id, ticket.department] as const] : [])).values()];
      return {
        id: project.id, code: project.projectId, name: project.name, status: project.status,
        finishedAt: project.endDate, department: project.department,
        departments: project.department ? [project.department] : inferredDepartments,
        assigned: mine.length, done, active, overdue,
        // A company-wide numerator contains the same people as the denominator,
        // which would turn every populated project into a meaningless 100%.
        contributionPercent: showContribution && allDone ? Math.round(done / allDone * 100) : null,
        hasStatusConflict: project.status === 'COMPLETED' && active > 0,
      };
    }).filter((project) => project.assigned > 0);
  }

  private async companyActiveProjects(range: Range) {
    const asOf = new Date(Math.min(range.end.getTime(), this.tva.now().getTime()));
    const projects = await this.prisma.project.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true, projectId: true, name: true, status: true, endDate: true,
        department: { select: { id: true, name: true } },
        tickets: { where: { createdAt: { lt: range.end } }, select: {
          id: true, status: true, createdAt: true, updatedAt: true,
          actualStartAt: true, actualCompletedAt: true, submittedAt: true,
          reviewStartedAt: true, closedAt: true, resolvedAt: true, cancelledAt: true,
          department: { select: { id: true, name: true } },
          history: { where: { field: 'status' }, orderBy: { changedAt: 'asc' } },
        } },
      },
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
    });

    return projects.map((project) => {
      const statuses = project.tickets.map((ticket) => ({ ticket, status: ticketStatusAt(ticket, asOf) }));
      const active = statuses.filter(({ status }) => status != null && ACTIVE_TICKET_STATUSES.includes(status)).length;
      const inProgress = statuses.filter(({ status }) => status === TicketStatus.IN_PROGRESS).length;
      const done = project.tickets.filter((ticket) => {
        const completedAt = ticketCompletionAt(ticket);
        return completedAt && completedAt >= range.start && completedAt < range.end;
      }).length;
      const inferredDepartments = [...new Map(project.tickets
        .flatMap((ticket) => ticket.department ? [[ticket.department.id, ticket.department] as const] : [])).values()];
      return {
        id: project.id, code: project.projectId, name: project.name, status: project.status,
        finishedAt: project.endDate, department: project.department,
        departments: project.department ? [project.department] : inferredDepartments,
        assigned: project.tickets.length, active, inProgress, done, overdue: 0,
        contributionPercent: null, hasStatusConflict: false,
      };
    });
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

  async getInsights(viewer: any, query: { departmentId?: string; personId?: string; month?: string; week?: string; date?: string; calculationVersion?: string }) {
    const cacheKey = JSON.stringify([
      viewer.id,
      query.departmentId ?? 'all',
      query.personId ?? 'overall',
      query.month ?? this.tva.companyToday().slice(0, 7),
      query.week ?? 'all',
      query.date ?? 'month',
      query.calculationVersion ?? 'default',
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

  private async calculateInsights(viewer: any, query: { departmentId?: string; personId?: string; month?: string; week?: string; date?: string; calculationVersion?: string }) {
    const { range, weeks, mode } = this.resolveRange(query.month, query.week, query.date);
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
    const companyWide = overall && ['ADMIN', 'SUPER_ADMIN'].includes(scope.role) && !scope.departmentId;
    const fullCalendar = await this.scheduledDates(range);
    const schedule = {
      dates: fullCalendar.dates.filter((date) => hasElapsedDays && date <= effectiveTo),
      calendarResolved: fullCalendar.calendarResolved,
    };
    const employeeSchedule = await this.scheduledEmployeeDays(userIds, schedule.dates);
    const [current, attendance, identity, attendanceCalendar, leaveUsage, tickets, projects] = await Promise.all([
      this.timeMetrics(userIds, effectiveRange, overall, schedule.dates, employeeSchedule.eligible),
      this.attendanceMetrics(userIds, schedule.dates, employeeSchedule.eligible, employeeSchedule.employmentExcludedDays),
      personId ? this.liveIdentity(personId) : Promise.resolve(null),
      personId && mode === 'MONTH'
        ? this.personalAttendanceCalendar(personId, range, fullCalendar.calendarDays)
        : Promise.resolve([]),
      personId && this.leaveBalanceService
        ? this.personalLeaveUsage(personId, range.start).catch(() => null)
        : Promise.resolve(null),
      this.ticketMetrics(userIds, effectiveRange),
      companyWide ? this.companyActiveProjects(effectiveRange) : this.projects(userIds, effectiveRange, true),
    ]);
    // Scheduled employee-days are the fair denominator: holidays and weekly
    // offs disappear, while absence and half-day attendance remain visible
    // instead of vanishing from the average merely because no session exists.
    const denominatorResolved = schedule.calendarResolved && employeeSchedule.unresolvedScheduleDays === 0;
    const calculationComplete = denominatorResolved
      && attendance.missingDays === 0
      && attendance.unresolvedDays === 0;
    const average = (value: number) => calculationComplete && attendance.expectedEmployeeDays
      ? Math.round(value / attendance.expectedEmployeeDays)
      : null;
    return {
      target: personId ? 'PERSON' : 'OVERALL',
      scope: { role: scope.role, people: userIds.length, departmentId: scope.departmentId, companyWide },
      period: { month: range.from.slice(0, 7), mode, week: query.week ?? 'all', date: mode === 'DAY' ? range.from : null, from: range.from, to: range.to, dataThrough: hasElapsedDays ? effectiveTo : null, weeks },
      identity,
      tickets,
      projects,
      workday: {
        daysWorked: current.daysWorked,
        calendarResolved: schedule.calendarResolved,
        denominatorResolved,
        calculationComplete,
        unresolvedScheduleDays: employeeSchedule.unresolvedScheduleDays,
        attendanceCalendar,
        leaveUsage,
        ...attendance,
        workingMinutes: current.workingMinutes, presenceMinutes: current.presenceMinutes,
        productiveMinutes: current.productiveMinutes,
        ticketMinutes: current.ticketMinutes, meetingMinutes: current.meetingMinutes, breakMinutes: current.breakMinutes,
        breakCount: current.breakCount, measurablePresenceDays: current.measurablePresenceDays,
        meetingCount: current.meetingCount, meetingParticipationCount: current.meetingParticipationCount,
        punchInMinute: current.punchInMinute, punchOutMinute: current.punchOutMinute,
        punchInCount: current.punchInCount, punchOutCount: current.punchOutCount,
        averages: {
          workingMinutes: average(current.workingMinutes), productiveMinutes: average(current.productiveMinutes),
          breakMinutes: average(current.breakMinutes), meetingMinutes: average(current.meetingMinutes),
          breakCount: calculationComplete && attendance.expectedEmployeeDays
            ? Math.round(current.breakCount / attendance.expectedEmployeeDays * 10) / 10
            : null,
          meetingCount: calculationComplete && attendance.expectedEmployeeDays
            ? Math.round(current.meetingParticipationCount / attendance.expectedEmployeeDays * 10) / 10
            : null,
        },
      },
    };
  }
}
