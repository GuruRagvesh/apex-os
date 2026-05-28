import { Injectable } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type SlaMap = Record<string, number>;

export type TicketTimingState = {
  timerType: 'none' | 'scheduled' | 'execution' | 'review' | 'blocked' | 'completed' | 'cancelled';
  label: string;
  isOverdue: boolean;
  dueAt: Date | null;
  remainingMs: number;
  overdueMs: number;
  responsibleRole: string | null;
  displayColor: string;
  progressPercent: number;
  reason: string;
};

const DEFAULT_SLA: SlaMap = { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };
const DEFAULT_REVIEW_SLA: SlaMap = { URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48 };

@Injectable()
export class TicketTimingService {
  constructor(private prisma: PrismaService) {}

  async getSlaConfig(): Promise<{ execution: SlaMap; review: SlaMap }> {
    const [execution, review] = await Promise.all([
      this.readSlaSetting('sla', DEFAULT_SLA),
      this.readSlaSetting('review_sla', DEFAULT_REVIEW_SLA),
    ]);
    return { execution, review };
  }

  async decorateTicket<T extends Record<string, any>>(ticket: T): Promise<T & Record<string, any>> {
    const config = await this.getSlaConfig();
    return this.decorateTicketWithConfig(ticket, config);
  }

  async decorateTickets<T extends Record<string, any>>(tickets: T[]): Promise<Array<T & Record<string, any>>> {
    const config = await this.getSlaConfig();
    return tickets.map((ticket) => this.decorateTicketWithConfig(ticket, config));
  }

  decorateTicketWithConfig<T extends Record<string, any>>(
    ticket: T,
    config: { execution: SlaMap; review: SlaMap },
    now = new Date(),
  ): T & Record<string, any> {
    const timing = this.getTimingState(ticket, config, now);
    const overdueMinutes = Math.max(0, Math.floor(timing.overdueMs / 60_000));
    const legacyOverdue = this.formatOverdue(overdueMinutes);

    return {
      ...ticket,
      timing,
      timerType: timing.timerType,
      dueAt: timing.dueAt,
      isOverdue: timing.isOverdue,
      overdueMinutes,
      overdueDisplay: timing.isOverdue ? legacyOverdue.display : null,
      overdueSeverity: timing.isOverdue ? legacyOverdue.severity : null,
      slaPercent: timing.progressPercent,
      slaProgress: timing.progressPercent,
    };
  }

  getTimingState(
    ticket: Record<string, any>,
    config: { execution: SlaMap; review: SlaMap },
    now = new Date(),
  ): TicketTimingState {
    const status = ticket.status as TicketStatus;
    const priority = String(ticket.priority ?? 'MEDIUM');

    // ── Terminal states always take priority — even over isBlocked ──────────
    if (status === TicketStatus.DONE) {
      return this.completed('completed', 'Ticket is done');
    }

    if (status === TicketStatus.CLOSED || ticket.cancelledAt) {
      return this.completed('cancelled', 'Ticket is closed');
    }

    // ── Blocked state — SLA paused (comes after terminal checks) ────────────
    if (ticket.isBlocked) {
      const frozenAt = this.asDate(ticket.blockedAt) ?? this.asDate(ticket.updatedAt);
      const startAt  = this.asDate(ticket.actualStartAt) ?? this.asDate(ticket.createdAt);
      const dueAt    = this.asDate(ticket.executionDueAt) ?? this.asDate(ticket.reviewDueAt);
      const total    = startAt && dueAt ? Math.max(1, dueAt.getTime() - startAt.getTime()) : 1;
      const elapsed  = startAt && frozenAt ? Math.max(0, frozenAt.getTime() - startAt.getTime()) : 0;
      return {
        timerType: 'blocked',
        label: 'Blocked — SLA paused',
        isOverdue: false,
        dueAt: frozenAt,
        remainingMs: 0,
        overdueMs: 0,
        responsibleRole: null,
        displayColor: 'amber',
        progressPercent: Math.min(100, Math.round((elapsed / total) * 100)),
        reason: ticket.blockedReason ?? 'Ticket is blocked — timer is paused',
      };
    }

    if (status === TicketStatus.REVIEW) {
      const startedAt = this.asDate(ticket.reviewStartedAt) ?? this.asDate(ticket.submittedAt) ?? this.asDate(ticket.updatedAt);
      const dueAt =
        this.asDate(ticket.reviewDueAt) ??
        this.addHours(startedAt, this.hoursFor(priority, config.review, DEFAULT_REVIEW_SLA));
      return this.stateFromDue({
        timerType: 'review',
        label: 'Review SLA',
        dueAt,
        startAt: startedAt,
        now,
        responsibleRole: 'REVIEWER',
        reason: dueAt ? 'Ticket is waiting for review' : 'Review timer has no due basis',
      });
    }

    if (status === TicketStatus.IN_PROGRESS) {
      const startedAt = this.asDate(ticket.actualStartAt) ?? this.asDate(ticket.updatedAt) ?? this.asDate(ticket.createdAt);
      const dueAt =
        this.asDate(ticket.executionDueAt) ??
        this.addMinutes(startedAt, ticket.estimatedMinutes) ??
        this.asDate(ticket.dueDate) ??
        this.addHours(startedAt, this.hoursFor(priority, config.execution, DEFAULT_SLA));
      return this.stateFromDue({
        timerType: 'execution',
        label: 'Execution SLA',
        dueAt,
        startAt: startedAt,
        now,
        responsibleRole: 'ASSIGNEE',
        reason: dueAt ? 'Ticket is in progress' : 'Execution timer has no due basis',
      });
    }

    if (status === TicketStatus.OPEN) {
      const scheduledStartAt = this.asDate(ticket.scheduledStartAt);
      if (scheduledStartAt && scheduledStartAt.getTime() > now.getTime()) {
        return this.stateFromDue({
          timerType: 'scheduled',
          label: 'Scheduled',
          dueAt: scheduledStartAt,
          startAt: this.asDate(ticket.createdAt),
          now,
          responsibleRole: null,
          reason: 'Ticket work has not reached its scheduled start',
        });
      }

      const dueAt =
        (scheduledStartAt && this.addMinutes(scheduledStartAt, ticket.estimatedMinutes)) ||
        this.asDate(ticket.dueDate);

      if (!dueAt) {
        return {
          timerType: 'none',
          label: 'No active SLA',
          isOverdue: false,
          dueAt: null,
          remainingMs: 0,
          overdueMs: 0,
          responsibleRole: null,
          displayColor: 'slate',
          progressPercent: 0,
          reason: 'Open ticket has no scheduled start, due date, or execution estimate',
        };
      }

      return this.stateFromDue({
        timerType: scheduledStartAt ? 'execution' : 'scheduled',
        label: scheduledStartAt ? 'Scheduled execution SLA' : 'Due date',
        dueAt,
        startAt: scheduledStartAt ?? this.asDate(ticket.createdAt),
        now,
        responsibleRole: scheduledStartAt ? 'ASSIGNEE' : null,
        reason: scheduledStartAt ? 'Scheduled start has passed' : 'Open ticket has an explicit due date',
      });
    }

    return {
      timerType: 'none',
      label: 'No active SLA',
      isOverdue: false,
      dueAt: null,
      remainingMs: 0,
      overdueMs: 0,
      responsibleRole: null,
      displayColor: 'slate',
      progressPercent: 0,
      reason: 'No timer applies to this ticket status',
    };
  }

  private async readSlaSetting(key: string, defaults: SlaMap): Promise<SlaMap> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const raw = row?.value;
    let parsed: any = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
    }
    const merged: SlaMap = { ...defaults };
    for (const priority of Object.keys(defaults)) {
      const value = Number(parsed?.[priority]);
      if (Number.isFinite(value) && value > 0) merged[priority] = value;
    }
    return merged;
  }

  private stateFromDue(input: {
    timerType: TicketTimingState['timerType'];
    label: string;
    dueAt: Date | null;
    startAt: Date | null;
    now: Date;
    responsibleRole: string | null;
    reason: string;
  }): TicketTimingState {
    const { timerType, label, dueAt, startAt, now, responsibleRole, reason } = input;
    if (!dueAt) {
      return {
        timerType,
        label,
        isOverdue: false,
        dueAt: null,
        remainingMs: 0,
        overdueMs: 0,
        responsibleRole,
        displayColor: 'slate',
        progressPercent: 0,
        reason,
      };
    }

    const diff = dueAt.getTime() - now.getTime();
    const isOverdue = diff < 0;
    const total = startAt ? Math.max(1, dueAt.getTime() - startAt.getTime()) : 1;
    const elapsed = startAt ? Math.max(0, now.getTime() - startAt.getTime()) : 0;
    const progressPercent = isOverdue ? 100 : Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
    const displayColor = isOverdue ? 'red' : progressPercent >= 80 ? 'amber' : 'blue';

    return {
      timerType,
      label,
      isOverdue,
      dueAt,
      remainingMs: Math.max(0, diff),
      overdueMs: Math.max(0, -diff),
      responsibleRole,
      displayColor,
      progressPercent,
      reason,
    };
  }

  private completed(timerType: 'completed' | 'cancelled', reason: string): TicketTimingState {
    return {
      timerType,
      label: timerType === 'completed' ? 'Completed' : 'Closed',
      isOverdue: false,
      dueAt: null,
      remainingMs: 0,
      overdueMs: 0,
      responsibleRole: null,
      displayColor: 'green',
      progressPercent: 100,
      reason,
    };
  }

  private asDate(value: any): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private addMinutes(start: Date | null, minutes: any): Date | null {
    const parsed = Number(minutes);
    if (!start || !Number.isFinite(parsed) || parsed <= 0) return null;
    return new Date(start.getTime() + parsed * 60_000);
  }

  private addHours(start: Date | null, hours: number): Date | null {
    if (!start || !Number.isFinite(hours) || hours <= 0) return null;
    return new Date(start.getTime() + hours * 3_600_000);
  }

  private hoursFor(priority: string, config: SlaMap, defaults: SlaMap): number {
    return Number(config[priority]) || defaults[priority] || defaults.MEDIUM;
  }

  private formatOverdue(minutes: number): { display: string; severity: string } {
    if (minutes <= 0) return { display: '', severity: 'slate' };
    if (minutes < 60) return { display: `${minutes}m overdue`, severity: 'orange' };
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return { display: `${hours}h overdue`, severity: hours >= 4 ? 'red' : 'deep-orange' };
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return {
      display: remHours > 0 ? `${days}d ${remHours}h overdue` : `${days}d overdue`,
      severity: 'red',
    };
  }
}
