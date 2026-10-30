import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TVAService } from '../../../common/services/tva.service';
import { BusinessCalendarService } from '../attendance/calendar/business-calendar.service';

type Interval = { start: Date; end: Date };

export type TimelineSegmentType =
  | 'TICKET'
  | 'REWORK'
  | 'OPEN'
  | 'REVIEW_WAIT'
  | 'COMPLETED'
  | 'OVERDUE_EXECUTION'
  | 'OVERDUE_REVIEW'
  | 'BREAK'
  | 'MEETING'
  | 'UNDEFINED';

export function segmentTypeForLedgerStage(stage: string): TimelineSegmentType {
  if (stage === 'REWORK') return 'REWORK';
  if (stage === 'REVIEW') return 'REVIEW_WAIT';
  return 'TICKET';
}

type RawSegment = Interval & {
  id: string;
  type: TimelineSegmentType;
  label: string;
  ticketDbId?: string;
  ticketId?: string;
  ticketTitle?: string;
  ticketStatus?: string;
  ticketStage?: string;
  projectName?: string | null;
  taskTypeName?: string | null;
  benchmarkMinutes?: number | null;
  blockedReason?: string | null;
  overdueReason?: 'EXECUTION_DELAY' | 'REVIEW_DELAY';
  breakType?: string;
  meetingTopic?: string | null;
};

export function subtractIntervals(base: Interval, exclusions: Interval[]): Interval[] {
  const clipped = exclusions
    .map((item) => ({
      start: new Date(Math.max(base.start.getTime(), item.start.getTime())),
      end: new Date(Math.min(base.end.getTime(), item.end.getTime())),
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: Interval[] = [];
  let cursor = base.start.getTime();
  for (const item of clipped) {
    if (item.start.getTime() > cursor) result.push({ start: new Date(cursor), end: item.start });
    cursor = Math.max(cursor, item.end.getTime());
  }
  if (cursor < base.end.getTime()) result.push({ start: new Date(cursor), end: base.end });
  return result;
}

/** An overdue marker belongs only to the business date on which it begins. */
export function firstOverdueWindow(deadline: Date, resolvedAt: Date, overdueDayEnd: Date): Interval | null {
  const end = new Date(Math.min(resolvedAt.getTime(), overdueDayEnd.getTime()));
  return end > deadline ? { start: deadline, end } : null;
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function monthBounds(month: string): { first: string; last: string; days: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new BadRequestException('month must use YYYY-MM form');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  if (monthIndex < 1 || monthIndex > 12) throw new BadRequestException('month must be a real calendar month');
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, '0')}`, days };
}

function seconds(interval: Interval): number {
  return Math.max(0, Math.round((interval.end.getTime() - interval.start.getTime()) / 1000));
}

@Injectable()
export class ProductivityTimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly businessCalendar: BusinessCalendarService,
  ) {}

  private async requesterScope(requesterId: string) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      include: { role: true, department: true },
    });
    if (!requester || !requester.isActive) throw new ForbiddenException('Your account cannot view productivity timelines');
    const role = requester.role.name;
    if (!['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
      throw new ForbiddenException('Productivity timelines are available to supervisors only');
    }

    let ids: string[] = [];
    if (role === 'TEAM_LEAD') {
      const teams = await this.prisma.team.findMany({
        where: { teamLeadId: requester.id, isActive: true },
        select: { members: { select: { userId: true } } },
      });
      ids = [requester.id, ...teams.flatMap((team) => team.members.map((member) => member.userId))];
    } else if (role === 'MANAGER') {
      const access = await this.prisma.managerDeptAccess.findMany({ where: { managerId: requester.id } });
      const departmentIds = access.map((item) => item.departmentId);
      if (!departmentIds.length && requester.departmentId) departmentIds.push(requester.departmentId);
      if (departmentIds.length) {
        const people = await this.prisma.user.findMany({
          where: {
            isActive: true,
            isSystemAccount: false,
            id: { not: requester.id },
            departmentId: { in: [...new Set(departmentIds)] },
            role: { name: { in: ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'] } },
          },
          select: { id: true },
        });
        ids = people.map((person) => person.id);
      }
    } else {
      const people = await this.prisma.user.findMany({
        where: {
          isActive: true,
          isSystemAccount: false,
          id: { not: requester.id },
          role: { name: { in: ['MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'INTERN'] } },
        },
        select: { id: true },
      });
      ids = people.map((person) => person.id);
    }
    return { requester, role, ids: [...new Set(ids)] };
  }

  async people(requesterId: string) {
    const scope = await this.requesterScope(requesterId);
    if (!scope.ids.length) return [];
    return this.prisma.user.findMany({
      where: {
        id: { in: scope.ids }, isActive: true, isSystemAccount: false,
        ...(scope.role === 'TEAM_LEAD' ? { role: { name: { in: ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'] } } } : {}),
      },
      select: {
        id: true,
        name: true,
        photoUrl: true,
        avatar: true,
        role: { select: { name: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  async get(requesterId: string, userId: string, month: string) {
    const scope = await this.requesterScope(requesterId);
    if (!scope.ids.includes(userId)) throw new ForbiddenException('This person is outside your productivity timeline scope');
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, department: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const bounds = monthBounds(month);
    const rangeStart = this.tva.companyInstantAt(bounds.first, '00:00') as Date;
    const rangeEnd = this.tva.companyInstantAt(addDays(bounds.last, 1), '00:00') as Date;
    const now = this.tva.now();
    const liveEnd = now < rangeEnd ? now : rangeEnd;

    const [sessions, ticketLogs, breaks, tickets, attendance, attendanceProfile] = await Promise.all([
      this.prisma.workSession.findMany({
        where: {
          userId,
          startWorkAt: { lt: rangeEnd },
          OR: [{ logoutAt: null }, { logoutAt: { gt: rangeStart } }],
        },
        orderBy: { startWorkAt: 'asc' },
      }),
      this.prisma.ticketTimeLog.findMany({
        where: {
          userId,
          startedAt: { lt: rangeEnd },
          OR: [{ endedAt: null }, { endedAt: { gt: rangeStart } }],
        },
        include: {
          ticket: {
            include: {
              project: { select: { name: true } },
              taskType: { select: { name: true } },
            },
          },
        },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.breakLog.findMany({
        where: {
          userId,
          startAt: { lt: rangeEnd },
          OR: [{ endAt: null }, { endAt: { gt: rangeStart } }],
        },
        include: {
          meeting: { select: { topic: true } },
          ticketTimeLogs: {
            where: { userId },
            select: { ticketId: true },
            orderBy: { startedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.ticket.findMany({
        where: {
          createdAt: { lt: rangeEnd },
          AND: [
            { OR: [
              { assignedToId: userId },
              { assignees: { some: { userId } } },
              { timeLogs: { some: { userId } } },
            ] },
            { OR: [
              { actualCompletedAt: null },
              { actualCompletedAt: { gt: rangeStart } },
              { timeLogs: { some: { userId, startedAt: { lt: rangeEnd }, OR: [{ endedAt: null }, { endedAt: { gt: rangeStart } }] } } },
            ] },
          ],
        },
        include: {
          assignees: { where: { userId }, select: { assignedAt: true } },
          timeLogs: { where: { userId }, orderBy: { startedAt: 'asc' } },
          history: { where: { field: 'status' }, orderBy: { changedAt: 'asc' } },
          project: { select: { name: true } },
          taskType: { select: { name: true } },
        },
      }),
      this.prisma.dailyAttendance.findMany({
        where: {
          userId,
          date: { gte: new Date(`${bounds.first}T00:00:00.000Z`), lte: new Date(`${bounds.last}T00:00:00.000Z`) },
        },
        orderBy: { date: 'asc' },
      }),
      this.prisma.employeeAttendanceProfile.findFirst({
        where: {
          userId,
          effectiveFrom: { lt: rangeEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: rangeStart } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        select: { assignedHolidayCalendarId: true, assignedWeeklyOffPolicyId: true },
      }),
    ]);

    const [calendarYear, calendarMonth] = month.split('-').map(Number);
    const businessMonth = await this.businessCalendar.classifyMonth(calendarYear, calendarMonth, {
      holidayCalendarId: attendanceProfile?.assignedHolidayCalendarId ?? null,
      weeklyOffPolicyId: attendanceProfile?.assignedWeeklyOffPolicyId ?? null,
      strict: true,
    });

    const clip = (start: Date, end: Date | null | undefined): Interval | null => {
      const clippedStart = new Date(Math.max(start.getTime(), rangeStart.getTime()));
      const effectiveEnd = end ?? liveEnd;
      const clippedEnd = new Date(Math.min(effectiveEnd.getTime(), rangeEnd.getTime(), liveEnd.getTime()));
      return clippedEnd > clippedStart ? { start: clippedStart, end: clippedEnd } : null;
    };

    const raw: RawSegment[] = [];
    const recorded: Interval[] = [];
    const executionOverdueTicketIds = new Set<string>();
    const reviewOverdueTicketIds = new Set<string>();
    for (const log of ticketLogs) {
      const interval = clip(log.startedAt, log.endedAt);
      if (!interval) continue;
      recorded.push(interval);
      raw.push({
        ...interval,
        id: `ticket-${log.id}`,
        type: segmentTypeForLedgerStage(log.stage),
        label: log.stage === 'REWORK'
          ? `${log.ticket.title} · Rework`
          : log.stage === 'REVIEW'
            ? `${log.ticket.title} · Review`
            : `${log.ticket.title} · In progress`,
        ticketDbId: log.ticket.id,
        ticketId: log.ticket.ticketId,
        ticketTitle: log.ticket.title,
        ticketStatus: log.ticket.status,
        ticketStage: log.stage,
        projectName: log.ticket.project?.name ?? null,
        taskTypeName: log.ticket.taskType?.name ?? null,
        benchmarkMinutes: log.ticket.outputTargetMinutes ?? log.ticket.estimatedMinutes ?? null,
        blockedReason: log.ticket.isBlocked ? log.ticket.blockedReason ?? 'Blocked without a recorded reason' : null,
      });
    }
    for (const item of breaks) {
      const interval = clip(item.startAt, item.endAt);
      if (!interval) continue;
      recorded.push(interval);
      const meeting = item.breakType === 'MEETING';
      const linkedTicketId = item.ticketTimeLogs[0]?.ticketId;
      const linkedTicket = linkedTicketId ? tickets.find((ticket) => ticket.id === linkedTicketId) : undefined;
      raw.push({
        ...interval,
        id: `${meeting ? 'meeting' : 'break'}-${item.id}`,
        type: meeting ? 'MEETING' : 'BREAK',
        label: meeting ? item.meeting?.topic ?? 'Meeting' : item.breakType.replaceAll('_', ' ').toLowerCase(),
        ticketDbId: linkedTicket?.id,
        ticketId: linkedTicket?.ticketId,
        ticketTitle: linkedTicket?.title,
        ticketStatus: linkedTicket?.status,
        projectName: linkedTicket?.project?.name ?? null,
        taskTypeName: linkedTicket?.taskType?.name ?? null,
        breakType: item.breakType,
        meetingTopic: item.meeting?.topic ?? null,
      });
    }

    // Undefined is deliberately calculated only inside an active work session.
    // Open/review waiting bands are status context, not recorded work, so they
    // do not reduce this honest "nothing recorded" duration.
    for (const session of sessions) {
      if (!session.startWorkAt) continue;
      const interval = clip(session.startWorkAt, session.logoutAt ?? session.autoClosedAt);
      if (!interval) continue;
      for (const gap of subtractIntervals(interval, recorded)) {
        if (seconds(gap) < 60) continue;
        raw.push({ ...gap, id: `undefined-${session.id}-${gap.start.getTime()}`, type: 'UNDEFINED', label: 'Undefined' });
      }
    }

    for (const ticket of tickets) {
      const assignedAt = ticket.assignees[0]?.assignedAt ?? ticket.createdAt;
      const addStatusBand = (status: string, start: Date, end: Date, suffix: string) => {
        const type: TimelineSegmentType | null = status === 'OPEN' || status === 'PENDING_APPROVAL'
          ? 'OPEN'
          : status === 'REVIEW'
            ? 'REVIEW_WAIT'
            : null;
        if (!type) return;
        // Daily analysis is event-based: show an Open/Review stage only on
        // the business day when that stage began. A pending stage must not
        // become a bar repeated across every later day in the month.
        const stageDate = this.tva.companyBusinessDate(start);
        const stageDayEnd = this.tva.companyInstantAt(addDays(stageDate, 1), '00:00') as Date;
        const interval = clip(start, new Date(Math.min(end.getTime(), stageDayEnd.getTime())));
        if (!interval) return;
        raw.push({
          ...interval,
          id: `status-${type.toLowerCase()}-${ticket.id}-${suffix}`,
          type,
          label: type === 'OPEN' ? `${ticket.ticketId} · Open / not started` : `${ticket.ticketId} · Awaiting review`,
          ticketDbId: ticket.id,
          ticketId: ticket.ticketId,
          ticketTitle: ticket.title,
          ticketStatus: status,
          projectName: ticket.project?.name ?? null,
          taskTypeName: ticket.taskType?.name ?? null,
        });
      };

      if (ticket.history.length) {
        let status = ticket.history[0].oldValue ?? 'OPEN';
        let cursor = assignedAt;
        for (const [index, change] of ticket.history.entries()) {
          if (change.changedAt > cursor) addStatusBand(status, cursor, change.changedAt, String(index));
          cursor = change.changedAt > cursor ? change.changedAt : cursor;
          status = change.newValue ?? status;
        }
        addStatusBand(status, cursor, ticket.actualCompletedAt ?? ticket.closedAt ?? liveEnd, 'current');
      } else {
        const firstLog = ticket.timeLogs[0]?.startedAt ?? ticket.actualStartAt;
        if (firstLog && firstLog > assignedAt) addStatusBand('OPEN', assignedAt, firstLog, 'initial');
        if (ticket.submittedAt) {
          addStatusBand('REVIEW', ticket.submittedAt, ticket.actualCompletedAt ?? ticket.closedAt ?? liveEnd, 'review');
        }
      }

      const completedAt = ticket.actualCompletedAt ?? ticket.resolvedAt ?? ticket.closedAt;
      if (completedAt) {
        const interval = clip(completedAt, new Date(completedAt.getTime() + 60_000));
        if (interval) raw.push({
          ...interval,
          id: `completed-${ticket.id}`,
          type: 'COMPLETED',
          label: `${ticket.ticketId} · Completed`,
          ticketDbId: ticket.id,
          ticketId: ticket.ticketId,
          ticketTitle: ticket.title,
          ticketStatus: ticket.status,
          projectName: ticket.project?.name ?? null,
          taskTypeName: ticket.taskType?.name ?? null,
        });
      }
      const executionDeadline = ticket.executionDueAt ?? ticket.dueDate;
      const executionEnd = ticket.submittedAt ?? ticket.actualCompletedAt ?? ticket.closedAt ?? null;
      if (executionDeadline && (!executionEnd || executionEnd > executionDeadline)) {
        const overdueDate = this.tva.companyBusinessDate(executionDeadline);
        const overdueDayEnd = this.tva.companyInstantAt(addDays(overdueDate, 1), '00:00') as Date;
        const firstDay = firstOverdueWindow(executionDeadline, executionEnd ?? liveEnd, overdueDayEnd);
        const interval = firstDay ? clip(firstDay.start, firstDay.end) : null;
        if (interval) {
          executionOverdueTicketIds.add(ticket.id);
          raw.push({
            ...interval,
            id: `overdue-execution-${ticket.id}`,
            type: 'OVERDUE_EXECUTION',
            label: `${ticket.ticketId} · User overdue`,
            ticketDbId: ticket.id,
            ticketId: ticket.ticketId,
            ticketTitle: ticket.title,
            ticketStatus: ticket.status,
            projectName: ticket.project?.name ?? null,
            taskTypeName: ticket.taskType?.name ?? null,
            overdueReason: 'EXECUTION_DELAY',
          });
        }
      }
      const reviewEnd = ticket.actualCompletedAt ?? ticket.resolvedAt ?? ticket.closedAt ?? null;
      if (ticket.reviewDueAt && (!reviewEnd || reviewEnd > ticket.reviewDueAt)) {
        const overdueDate = this.tva.companyBusinessDate(ticket.reviewDueAt);
        const overdueDayEnd = this.tva.companyInstantAt(addDays(overdueDate, 1), '00:00') as Date;
        const firstDay = firstOverdueWindow(ticket.reviewDueAt, reviewEnd ?? liveEnd, overdueDayEnd);
        const interval = firstDay ? clip(firstDay.start, firstDay.end) : null;
        if (interval) {
          reviewOverdueTicketIds.add(ticket.id);
          raw.push({
            ...interval,
            id: `overdue-review-${ticket.id}`,
            type: 'OVERDUE_REVIEW',
            label: `${ticket.ticketId} · Review overdue`,
            ticketDbId: ticket.id,
            ticketId: ticket.ticketId,
            ticketTitle: ticket.title,
            ticketStatus: ticket.status,
            projectName: ticket.project?.name ?? null,
            taskTypeName: ticket.taskType?.name ?? null,
            overdueReason: 'REVIEW_DELAY',
          });
        }
      }
    }

    const dayRows = Array.from({ length: bounds.days }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`;
      const dayStart = this.tva.companyInstantAt(date, '00:00') as Date;
      const dayEnd = this.tva.companyInstantAt(addDays(date, 1), '00:00') as Date;
      const daySegments = raw.flatMap((segment) => {
        const start = new Date(Math.max(dayStart.getTime(), segment.start.getTime()));
        const end = new Date(Math.min(dayEnd.getTime(), segment.end.getTime()));
        if (end <= start) return [];
        return [{
          ...segment,
          id: `${segment.id}-${date}`,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          startMinute: Math.max(0, (start.getTime() - dayStart.getTime()) / 60_000),
          endMinute: Math.min(1440, (end.getTime() - dayStart.getTime()) / 60_000),
          durationSeconds: seconds({ start, end }),
          continuesBefore: segment.start < dayStart,
          continuesAfter: segment.end > dayEnd,
        }];
      }).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
      const actual = daySegments.filter((item) => item.ticketStage || ['BREAK', 'MEETING', 'UNDEFINED'].includes(item.type));
      const total = (type: TimelineSegmentType) => actual.filter((item) => item.type === type).reduce((sum, item) => sum + item.durationSeconds, 0);
      const productiveSeconds = actual.filter((item) => !!item.ticketStage).reduce((sum, item) => sum + item.durationSeconds, 0);
      const dayAttendance = attendance.find((item) => item.date.toISOString().slice(0, 10) === date);
      const calendarDay = businessMonth.days[index];
      const plannedDayStatus = calendarDay.reason === 'HOLIDAY' || calendarDay.reason === 'COMPANY_CLOSURE'
        ? 'HOLIDAY'
        : ['SUNDAY', 'SECOND_SATURDAY', 'FOURTH_SATURDAY'].includes(calendarDay.reason)
          ? 'WEEKLY_OFF'
          : null;
      const daySessions = sessions.filter((session) => {
        const start = session.startWorkAt;
        const end = session.logoutAt ?? session.autoClosedAt ?? liveEnd;
        return !!start && start < dayEnd && end > dayStart;
      });
      const touched = new Set(daySegments.filter((item) => item.ticketStage && item.ticketDbId).map((item) => item.ticketDbId));
      const completed = tickets.filter((ticket) => ticket.actualCompletedAt && ticket.actualCompletedAt >= dayStart && ticket.actualCompletedAt < dayEnd).length;
      return {
        date,
        dayNumber: index + 1,
        weekday: new Date(`${date}T12:00:00.000Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        attendanceStatus: plannedDayStatus ?? dayAttendance?.status ?? null,
        evaluationState: dayAttendance?.evaluationState ?? null,
        segments: daySegments,
        kpis: {
          productiveSeconds,
          meetingSeconds: total('MEETING'),
          breakSeconds: total('BREAK'),
          undefinedSeconds: total('UNDEFINED'),
          sessionCount: daySessions.length,
          ticketsTouched: touched.size,
          ticketsCompleted: completed,
        },
      };
    });

    const sum = (key: keyof (typeof dayRows)[number]['kpis']) => dayRows.reduce((total, day) => total + day.kpis[key], 0);
    const ticketTotals = new Map<string, { ticketDbId: string; ticketId: string; title: string; seconds: number; benchmarkMinutes: number | null }>();
    for (const segment of raw.filter((item) => item.ticketStage && item.ticketDbId)) {
      const current = ticketTotals.get(segment.ticketDbId!) ?? {
        ticketDbId: segment.ticketDbId!, ticketId: segment.ticketId!, title: segment.ticketTitle!, seconds: 0, benchmarkMinutes: segment.benchmarkMinutes ?? null,
      };
      current.seconds += seconds(segment);
      ticketTotals.set(segment.ticketDbId!, current);
    }
    const actualTicketSegments = raw.filter((item) => !!item.ticketStage);
    const overlappingTicketIds = new Set<string>();
    for (let left = 0; left < actualTicketSegments.length; left += 1) {
      for (let right = left + 1; right < actualTicketSegments.length; right += 1) {
        if (actualTicketSegments[left].ticketDbId === actualTicketSegments[right].ticketDbId) continue;
        if (actualTicketSegments[left].start < actualTicketSegments[right].end && actualTicketSegments[right].start < actualTicketSegments[left].end) {
          if (actualTicketSegments[left].ticketDbId) overlappingTicketIds.add(actualTicketSegments[left].ticketDbId!);
          if (actualTicketSegments[right].ticketDbId) overlappingTicketIds.add(actualTicketSegments[right].ticketDbId!);
        }
      }
    }

    return {
      identity: {
        id: target.id, name: target.name, role: target.role.name,
        department: target.department ? { id: target.department.id, name: target.department.name } : null,
      },
      month,
      timezone: this.tva.companyTimezone(),
      rangePages: [{ from: 1, to: Math.min(10, bounds.days) }, { from: 11, to: Math.min(20, bounds.days) }, { from: 21, to: bounds.days }],
      days: dayRows,
      ledger: {
        productiveSeconds: sum('productiveSeconds'),
        meetingSeconds: sum('meetingSeconds'),
        breakSeconds: sum('breakSeconds'),
        undefinedSeconds: sum('undefinedSeconds'),
        sessionCount: sessions.length,
        ticketsTouched: new Set(raw.filter((item) => item.ticketStage && item.ticketDbId).map((item) => item.ticketDbId)).size,
        ticketsCompleted: sum('ticketsCompleted'),
        executionOverdueTickets: executionOverdueTicketIds.size,
        reviewOverdueTickets: reviewOverdueTicketIds.size,
        overlappingTickets: overlappingTicketIds.size,
        blockedTickets: tickets.filter((ticket) => ticket.isBlocked).length,
      },
      ticketAnalysis: [...ticketTotals.values()].map((item) => ({
        ...item,
        actualMinutes: Math.round(item.seconds / 60),
        varianceMinutes: item.benchmarkMinutes == null ? null : Math.round(item.seconds / 60) - item.benchmarkMinutes,
        comparison: item.benchmarkMinutes == null ? 'NO_BENCHMARK' : 'PLANNED_VS_ACTUAL',
      })),
    };
  }
}
