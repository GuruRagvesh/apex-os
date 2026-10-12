import { BadRequestException, Injectable } from '@nestjs/common';
import { LeaveStatus, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';
import { TVAService } from '../../../common/services/tva.service';
import { addDays } from '../analytics/analytics-period';
import { DashboardService } from './dashboard.service';

/** Statuses that count as "active" work on the Home hero. */
const ACTIVE_STATUSES = [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.REVIEW];
const DONE_STATUSES = [TicketStatus.DONE, TicketStatus.CLOSED];
const LEAD_ROLES = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];
/** Two months plus a week covers a calendar month and the week before it. */
const MAX_RANGE_DAYS = 70;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface HomeInsightDay {
  date: string;
  ticketsDone: number;
  ticketsSubmitted: number;
  ticketMinutes: number;
  estimatedMinutesDone: number;
  doneTickets: { id: string; ticketId: string; title: string }[];
}

/**
 * Read-only figures for the personal Home view: the hero KPIs and a per-day
 * productivity series for the signed-in user. It never writes.
 *
 * Attendance figures (worked time, breaks, punches) are deliberately not
 * repeated here: the Home calendar reads them from /attendance/me/v2, the
 * single authority for attendance.
 */
@Injectable()
export class HomeInsightsService {
  constructor(
    private prisma: PrismaService,
    private ticketAccess: TicketAccessService,
    private leaveAccess: LeaveAccessService,
    private tva: TVAService,
    private dashboard: DashboardService,
  ) {}

  private andWhere(...clauses: any[]): any {
    const parts = clauses.filter((c) => c && Object.keys(c).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }

  /** Tickets this user is responsible for: primary assignee or co-assignee. */
  private mine(userId: string) {
    return { OR: [{ assignedToId: userId }, { assignees: { some: { userId } } }] };
  }

  async getKpis(user: any) {
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    const isLead = LEAD_ROLES.includes(roleName);
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const projectScope = await this.dashboard.buildProjectScope(user);
    const active = { status: { in: ACTIVE_STATUSES } };

    const [myActive, teamActive, activeProjects, myInReview] = await Promise.all([
      this.prisma.ticket.count({ where: this.andWhere(this.mine(user.id), active) }),
      isLead ? this.prisma.ticket.count({ where: this.andWhere(ticketScope, active) }) : Promise.resolve(null),
      this.prisma.project.count({ where: this.andWhere(projectScope, { status: 'ACTIVE' }) }),
      this.prisma.ticket.count({ where: this.andWhere(this.mine(user.id), { status: TicketStatus.REVIEW }) }),
    ]);

    let pendingTicketApprovals: number | null = null;
    let pendingLeaveApprovals: number | null = null;
    if (isLead) {
      // Same rule as the REVIEW_PENDING alert: QUERY tickets are approved by
      // their creator only, so a visible QUERY someone else raised is excluded.
      pendingTicketApprovals = await this.prisma.ticket.count({
        where: this.andWhere(ticketScope, {
          status: TicketStatus.REVIEW,
          OR: [{ NOT: { type: 'QUERY' } }, { type: 'QUERY', createdById: user.id }],
        }),
      });
      const leaveScope = await this.leaveAccess.buildLeaveWhereForUser({}, user);
      pendingLeaveApprovals = await this.prisma.leaveRequest.count({
        where: this.andWhere(leaveScope, { status: LeaveStatus.PENDING, NOT: { userId: user.id } }),
      });
    }

    return {
      activeTickets: { mine: myActive, team: teamActive },
      activeProjects,
      pendingTicketApprovals,
      pendingLeaveApprovals,
      myInReview,
    };
  }

  /**
   * One row per company business date in [from, to], inclusive.
   * Days are bucketed in the company timezone, never server-local time.
   */
  async getDailyProductivity(user: any, from?: string, to?: string): Promise<HomeInsightDay[]> {
    const today = this.tva.companyBusinessDate();
    const end = to ?? today;
    const start = from ?? addDays(end, -6);
    if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end) {
      throw new BadRequestException('from and to must be YYYY-MM-DD with from <= to');
    }
    const span = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
    if (span > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Range is limited to ${MAX_RANGE_DAYS} days`);
    }

    const rangeStart = this.tva.companyInstantAt(start, '00:00') as Date;
    const rangeEnd = this.tva.companyInstantAt(addDays(end, 1), '00:00') as Date;
    const inRange = { gte: rangeStart, lt: rangeEnd };
    const mine = this.mine(user.id);

    const [done, submitted, logs] = await Promise.all([
      this.prisma.ticket.findMany({
        where: this.andWhere(mine, { status: { in: DONE_STATUSES }, closedAt: inRange }),
        select: { id: true, ticketId: true, title: true, closedAt: true, estimatedMinutes: true },
      }),
      this.prisma.ticket.findMany({
        where: this.andWhere(mine, { submittedAt: inRange }),
        select: { submittedAt: true },
      }),
      this.prisma.ticketTimeLog.findMany({
        where: {
          userId: user.id,
          countsAsWork: true,
          startedAt: { lt: rangeEnd },
          OR: [{ endedAt: null }, { endedAt: { gt: rangeStart } }],
        },
        select: { startedAt: true, endedAt: true, durationSeconds: true },
      }),
    ]);

    const days = new Map<string, HomeInsightDay>();
    for (let d = start; d <= end; d = addDays(d, 1)) {
      days.set(d, { date: d, ticketsDone: 0, ticketsSubmitted: 0, ticketMinutes: 0, estimatedMinutesDone: 0, doneTickets: [] });
    }
    const bucket = (at: Date | null | undefined) => (at ? days.get(this.tva.companyBusinessDate(at)) : undefined);

    for (const t of done) {
      const row = bucket(t.closedAt);
      if (!row) continue;
      row.ticketsDone += 1;
      row.estimatedMinutesDone += t.estimatedMinutes ?? 0;
      row.doneTickets.push({ id: t.id, ticketId: t.ticketId, title: t.title });
    }
    for (const t of submitted) {
      const row = bucket(t.submittedAt);
      if (row) row.ticketsSubmitted += 1;
    }

    // Split each time log across the company days it covers, so a timer left
    // running past midnight is not credited entirely to the day it started.
    const now = this.tva.now();
    for (const log of logs) {
      const from = Math.max(log.startedAt.getTime(), rangeStart.getTime());
      const loggedEnd = log.endedAt
        ?? (log.durationSeconds != null ? new Date(log.startedAt.getTime() + log.durationSeconds * 1000) : now);
      const until = Math.min(loggedEnd.getTime(), rangeEnd.getTime(), now.getTime());
      let cursor = from;
      while (cursor < until) {
        const date = this.tva.companyBusinessDate(new Date(cursor));
        const nextDay = (this.tva.companyInstantAt(addDays(date, 1), '00:00') as Date).getTime();
        const sliceEnd = Math.min(until, nextDay);
        const row = days.get(date);
        if (row) row.ticketMinutes += (sliceEnd - cursor) / 60_000;
        cursor = sliceEnd;
      }
    }
    for (const row of days.values()) row.ticketMinutes = Math.round(row.ticketMinutes);

    return [...days.values()];
  }
}
