import { BadRequestException, Injectable } from '@nestjs/common';
import { LeaveStatus, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';
import { TVAService } from '../../../common/services/tva.service';
import { addDays } from '../analytics/analytics-period';
import { LeaveService } from '../../operations/leave/leave.service';

const DONE_STATUSES = [TicketStatus.DONE, TicketStatus.CLOSED];
const LEAD_ROLES = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];
/** Two months plus a week covers a calendar month and the week before it. */
const MAX_RANGE_DAYS = 70;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface HomeInsightDay {
  date: string;
  ticketsCreated: number;
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
    private leaveAccess: LeaveAccessService,
    private tva: TVAService,
    private leaveService: LeaveService,
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
    const roleName = String(user?.role?.name ?? user?.role ?? '').toUpperCase();
    const isLead = LEAD_ROLES.includes(roleName);
    const mine = this.mine(user.id);
    const ownProjectScope = { members: { some: { userId: user.id } } };
    // Admins and managers operate across the company for this headline count.
    // Team leads and contributors see only projects they personally belong to.
    const activeProjectScope = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName)
      ? {}
      : ownProjectScope;
    const leaveScope = isLead ? await this.leaveAccess.buildLeaveWhereForUser({}, user) : null;

    const [
      mineOpen, mineInProgress, mineInReview, pendingTicketApprovals, activeProjects, pendingLeaveCandidates,
    ] = await Promise.all([
      this.prisma.ticket.count({ where: this.andWhere(mine, { status: TicketStatus.OPEN }) }),
      this.prisma.ticket.count({ where: this.andWhere(mine, { status: TicketStatus.IN_PROGRESS }) }),
      this.prisma.ticket.count({ where: this.andWhere(mine, { status: TicketStatus.REVIEW }) }),
      // A pending task is actionable only for its recorded approver. This is
      // the same queue exposed by TicketsService.getPendingApprovals().
      isLead ? this.prisma.ticket.count({ where: { approverId: user.id, status: TicketStatus.PENDING_APPROVAL, approvalState: 'PENDING' } }) : Promise.resolve(0),
      this.prisma.project.count({ where: this.andWhere(activeProjectScope, { status: 'ACTIVE' }) }),
      isLead ? this.prisma.leaveRequest.findMany({
        where: this.andWhere(leaveScope!, { status: LeaveStatus.PENDING, NOT: { userId: user.id } }),
        include: { user: { include: { role: true, department: true } } },
      }) : Promise.resolve([]),
    ]);
    const scopeLeaveApprovals = isLead
      ? (await Promise.all(pendingLeaveCandidates.map(async (leave) => this.leaveService.viewerCanApprove(user, leave)))).filter(Boolean).length
      : 0;
    const mineKpis = {
      openTickets: mineOpen,
      inProgressTickets: mineInProgress,
      underReviewTickets: mineInReview,
      pendingTicketApprovals,
      activeProjects,
      leaveApprovals: scopeLeaveApprovals,
    };

    // Retain the legacy response keys while deployed clients move to the
    // single role-aware snapshot above. There is no longer a second scope.
    return {
      mine: mineKpis,
      scoped: null,
      activeTickets: { mine: mineOpen + mineInProgress + mineInReview, team: null },
      activeProjects,
      pendingTicketApprovals: isLead ? pendingTicketApprovals : null,
      pendingLeaveApprovals: isLead ? scopeLeaveApprovals : null,
      myInReview: mineInReview,
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

    const [done, submitted, created, logs] = await Promise.all([
      this.prisma.ticket.findMany({
        where: this.andWhere(mine, { status: { in: DONE_STATUSES }, closedAt: inRange }),
        select: { id: true, ticketId: true, title: true, closedAt: true, estimatedMinutes: true },
      }),
      this.prisma.ticket.findMany({
        where: this.andWhere(mine, { submittedAt: inRange }),
        select: { submittedAt: true },
      }),
      // Workload created during the period and currently assigned to this
      // person. This keeps the personal comparison scoped like the rest of
      // the Home productivity view instead of counting company-wide tickets.
      this.prisma.ticket.findMany({
        where: this.andWhere(mine, { createdAt: inRange }),
        select: { createdAt: true },
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
      days.set(d, { date: d, ticketsCreated: 0, ticketsDone: 0, ticketsSubmitted: 0, ticketMinutes: 0, estimatedMinutesDone: 0, doneTickets: [] });
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
    for (const t of created) {
      const row = bucket(t.createdAt);
      if (row) row.ticketsCreated += 1;
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
