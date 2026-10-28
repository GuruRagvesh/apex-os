import { BadRequestException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PolicyVersionService } from '../../platform/attendance/policy/policy-version.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TVAService } from '../../../common/services/tva.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { BusinessCalendarService } from '../../platform/attendance/calendar/business-calendar.service';
import { EmployeeTimelineService } from '../../platform/attendance/timeline/employee-timeline.service';
import { NotificationEventService } from '../notifications/notification-event.service';

/**
 * Comp Off credits.
 *
 * A completed 12-hour elapsed-presence day earns 180 minutes. Breaks, meetings,
 * and gaps between multiple sessions remain inside the daily span. Three such days therefore total
 * one 540-minute (9-hour) comp-off day without an overlapping bonus.
 *
 * Consumption is likewise exact: a leave request for N qualifying days needs N
 * credits, and there is no fallback to Casual or Emergency entitlement.
 */

/** Qualifying weekly-off reasons. A plain working day never earns comp off. */
const QUALIFYING_WEEKLY_OFF = ['SUNDAY', 'SECOND_SATURDAY', 'FOURTH_SATURDAY'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LONG_DAY_MINUTES = 12 * 60;
const SINGLE_LONG_DAY_CREDIT_MINUTES = 3 * 60;
const FULL_COMP_OFF_DAY_MINUTES = 9 * 60;

export class CompOffSourceNotQualifyingError extends Error {
  constructor(businessDate: string, public readonly reasons: string[]) {
    super(
      `${businessDate} is an ordinary working day. Comp off is earned only on a Sunday, ` +
        'a 2nd or 4th Saturday, or an official company holiday.',
    );
    this.name = 'CompOffSourceNotQualifyingError';
  }
}

export class CompOffAlreadyGrantedError extends Error {
  constructor(businessDate: string) {
    super(`This employee already has a comp off credit for ${businessDate}.`);
    this.name = 'CompOffAlreadyGrantedError';
  }
}

export interface GrantCompOffInput {
  employeeId: string;
  earnedFromBusinessDate: string;
  reason: string;
  earnedFromWorkSessionId?: string | null;
}

@Injectable()
export class CompOffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly calendar: BusinessCalendarService,
    private readonly timeline: EmployeeTimelineService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly eventLogger: EventLoggerService,
    @Optional() private readonly policies?: PolicyVersionService,
    @Optional() private readonly notifications?: NotificationEventService,
  ) {}

  private shiftDate(date: string, days: number) {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }

  private async isCompanyWorkingDay(employeeId: string, businessDate: string) {
    const profile = await this.timeline.findProfileOn(employeeId, businessDate);
    const facts = await this.calendar.resolveBusinessDay(businessDate, {
      holidayCalendarId: profile?.assignedHolidayCalendarId ?? null,
      weeklyOffPolicyId: profile?.assignedWeeklyOffPolicyId ?? null,
      strict: true,
    });
    return facts.expectedCompanyWorkingDay;
  }

  private async elapsedPresenceMinutes(employeeId: string, dates: string[]) {
    const rows = await this.prisma.workSession.findMany({
      where: {
        userId: employeeId,
        date: { in: dates.map((date) => this.tva.companyDateOnly(new Date(`${date}T00:00:00.000Z`))) },
        logoutAt: { not: null },
      },
      select: { date: true, startWorkAt: true, logoutAt: true },
    });
    const bounds = new Map<string, { firstIn: number; lastOut: number }>();
    for (const row of rows) {
      const key = row.date.toISOString().slice(0, 10);
      const start = row.startWorkAt.getTime();
      const end = row.logoutAt!.getTime();
      const current = bounds.get(key);
      bounds.set(key, {
        firstIn: current ? Math.min(current.firstIn, start) : start,
        lastOut: current ? Math.max(current.lastOut, end) : end,
      });
    }
    const totals = new Map<string, number>();
    for (const [key, { firstIn, lastOut }] of bounds) {
      totals.set(key, Math.max(0, Math.floor((lastOut - firstIn) / 60_000)));
    }
    return totals;
  }

  private async createAutomaticCredit(
    employeeId: string,
    businessDate: string,
    workSessionId: string,
    rule: 'SINGLE_DAY_12_HOURS',
  ) {
    const expiryDays = await this.expiryDaysFor(employeeId, businessDate);
    let credit;
    try {
      credit = await this.prisma.compOffCredit.create({
        data: {
          employeeId,
          earnedFromBusinessDate: this.tva.companyDateOnly(new Date(`${businessDate}T00:00:00.000Z`)),
          earnedFromWorkSessionId: workSessionId,
          expiresAt: this.expiresOn(businessDate, expiryDays),
          status: 'AVAILABLE',
          creditMinutes: SINGLE_LONG_DAY_CREDIT_MINUTES,
          remainingMinutes: SINGLE_LONG_DAY_CREDIT_MINUTES,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') return null;
      throw error;
    }

    this.eventLogger.log({
      actorId: employeeId,
      entityType: 'CompOffCredit',
      entityId: credit.id,
      action: OperationalAction.COMP_OFF_GRANTED,
      metadata: { employeeId, earnedFromBusinessDate: businessDate, rule, expiresAt: credit.expiresAt },
    }).catch(() => {});
    this.notifications?.sendNotification(employeeId, 'system', {
      title: 'Comp-off earned',
      message: `You earned 3 hours of comp-off for working 12 or more hours on ${businessDate}. It expires in ${expiryDays} days.`,
      type: NotificationType.SUCCESS,
      link: '/leave',
      entityId: credit.id,
      entityType: 'CompOffCredit',
      dedupeKey: `comp-off-earned:${credit.id}`,
    }).catch(() => {});
    return credit;
  }

  /** Called after a real, completed punch-out/end-day; safe to retry. */
  async evaluateCompletedWorkday(employeeId: string, businessDate: string, workSessionId: string) {
    if (!DATE_RE.test(businessDate)) return null;
    // One employee-day has one elapsed clock: first punch-in/session start to
    // final punch-out/session end. Re-logins do not discard earlier time, and
    // breaks, meetings, and gaps between sessions are included.
    const currentMinutes = (await this.elapsedPresenceMinutes(employeeId, [businessDate])).get(businessDate) ?? 0;
    if (currentMinutes < LONG_DAY_MINUTES) return null;
    return this.createAutomaticCredit(employeeId, businessDate, workSessionId, 'SINGLE_DAY_12_HOURS');
  }

  /**
   * The single HR/Admin gate for comp off.
   *
   * grantManual applies it internally; read endpoints that expose another
   * employee's credits call this so the rule is stated once rather than
   * re-derived in a controller.
   */
  assertHrOrAdmin(actor: any) {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR can view or grant comp off for another employee');
    }
  }

  /** Calendar qualification for the 9-hour off-day earning rule. */
  async qualifyingSourceDay(employeeId: string, businessDate: string) {
    const profile = await this.timeline.findProfileOn(employeeId, businessDate);
    const facts = await this.calendar.resolveBusinessDay(businessDate, {
      holidayCalendarId: profile?.assignedHolidayCalendarId ?? null,
      weeklyOffPolicyId: profile?.assignedWeeklyOffPolicyId ?? null,
      strict: true,
    });
    const weekly = facts.weeklyOff.reasons.some((reason) =>
      QUALIFYING_WEEKLY_OFF.includes(reason),
    );
    return {
      // A SPECIAL_WORKING_DAY override wins over the normal Sunday/Saturday or
      // holiday label. The credit is for work on an actual non-working day,
      // not merely a date that would usually have been off.
      qualifies: !facts.expectedCompanyWorkingDay && (weekly || facts.holiday.isHoliday),
      reasons: [...facts.weeklyOff.reasons, ...(facts.holiday.isHoliday ? ['HOLIDAY'] : [])],
      facts,
    };
  }

  /** Expiry exactly N company-calendar days after the earned business date. */
  expiresOn(earnedFromBusinessDate: string, expiryDays = 30): Date {
    const earned = new Date(`${earnedFromBusinessDate}T00:00:00.000Z`);
    if (Number.isNaN(earned.getTime())) throw new Error('Invalid earned business date');
    earned.setUTCDate(earned.getUTCDate() + expiryDays);
    return earned;
  }

  /** Expiry days from the employee's effective leave policy, defaulting to 30. */
  private async expiryDaysFor(employeeId: string, businessDate: string): Promise<number> {
    const profile = await this.timeline.findProfileOn(employeeId, businessDate);
    if (!profile?.assignedLeavePolicyId) return 30;
    // Phase 3: the version of the assigned series governing that date.
    const policy = this.policies
      ? await this.policies.resolvePolicyOn('LEAVE_POLICY', businessDate, { id: profile.assignedLeavePolicyId })
      : null;
    return policy?.compOffExpiryDays ?? 30;
  }

  /**
   * Grants one comp off credit by hand. HR/Admin only.
   *
   * Deliberately narrow. A manual HR grant remains available as an audited
   * exception; automatic grants use evaluateCompletedWorkday above.
   */
  async grantManual(actor: any, input: GrantCompOffInput) {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR can grant comp off');
    }
    if (!DATE_RE.test(input.earnedFromBusinessDate ?? '')) {
      throw new BadRequestException('earnedFromBusinessDate must be a yyyy-MM-dd date');
    }
    if (!input.reason || input.reason.trim().length < 5) {
      throw new BadRequestException('A reason is required for a manual comp off grant');
    }

    const qualification = await this.qualifyingSourceDay(
      input.employeeId,
      input.earnedFromBusinessDate,
    );
    if (!qualification.qualifies) {
      throw new CompOffSourceNotQualifyingError(
        input.earnedFromBusinessDate,
        qualification.reasons,
      );
    }

    const earnedDate = this.tva.companyDateOnly(
      new Date(`${input.earnedFromBusinessDate}T00:00:00.000Z`),
    );
    const expiryDays = await this.expiryDaysFor(
      input.employeeId,
      input.earnedFromBusinessDate,
    );

    let credit;
    try {
      credit = await this.prisma.compOffCredit.create({
        data: {
          employeeId: input.employeeId,
          earnedFromBusinessDate: earnedDate,
          earnedFromWorkSessionId: input.earnedFromWorkSessionId ?? null,
          expiresAt: this.expiresOn(input.earnedFromBusinessDate, expiryDays),
          status: 'AVAILABLE',
          creditMinutes: FULL_COMP_OFF_DAY_MINUTES,
          remainingMinutes: FULL_COMP_OFF_DAY_MINUTES,
        },
      });
    } catch (err: any) {
      // The database owns this rule, so a concurrent second grant loses here
      // rather than both succeeding after each read an empty result.
      if (err?.code === 'P2002') {
        throw new CompOffAlreadyGrantedError(input.earnedFromBusinessDate);
      }
      throw err;
    }

    this.eventLogger.log({
      actorId: actor.id,
      entityType: 'CompOffCredit',
      entityId: credit.id,
      action: OperationalAction.COMP_OFF_GRANTED,
      metadata: {
        employeeId: input.employeeId,
        earnedFromBusinessDate: input.earnedFromBusinessDate,
        qualifyingReasons: qualification.reasons,
        expiresAt: credit.expiresAt,
        reason: input.reason.trim(),
      },
    }).catch(() => {});

    return credit;
  }

  /** The employee's own unexpired, unused credits. */
  async listAvailable(employeeId: string) {
    const today = this.tva.companyDateOnly(this.tva.now());
    const credits = await this.prisma.compOffCredit.findMany({
      where: { employeeId, status: 'AVAILABLE', expiresAt: { gte: today } },
      orderBy: [{ expiresAt: 'asc' }, { earnedAt: 'asc' }],
      select: {
        id: true,
        employeeId: true,
        earnedFromBusinessDate: true,
        earnedFromWorkSessionId: true,
        earnedAt: true,
        expiresAt: true,
        usedAt: true,
        leaveRequestId: true,
        status: true,
        creditMinutes: true,
        remainingMinutes: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return credits;
  }

  /**
   * Consumes exactly `requiredDays` credits inside LH-2's final approval.
   *
   * All-or-nothing: if the employee has fewer unexpired credits than the request
   * needs, NOTHING is consumed and null is returned. A partially funded comp off
   * would otherwise silently spend credits on leave that was never granted.
   *
   * The row lock is what makes two concurrent approvals safe. Both would
   * otherwise read the same available credits and each believe it could spend
   * them; `FOR UPDATE` serialises them, and the second sees only what is left.
   */
  async consumeForDays(
    tx: Prisma.TransactionClient,
    employeeId: string,
    leaveRequestId: string,
    requiredDays: number,
  ) {
    const neededMinutes = Math.ceil(Math.max(0, requiredDays) * FULL_COMP_OFF_DAY_MINUTES);
    if (neededMinutes === 0) return [];

    const today = this.tva.companyDateOnly(this.tva.now());
    // Oldest-expiring first, deterministically: a credit about to lapse is spent
    // before one with months left, so nobody loses entitlement to ordering luck.
    const rows = await tx.$queryRaw<Array<{ id: string; remainingMinutes: number }>>(
      Prisma.sql`SELECT id, "remainingMinutes" FROM "comp_off_credits"
        WHERE "employeeId" = ${employeeId}
          AND status = 'AVAILABLE'
          AND "remainingMinutes" > 0
          AND "expiresAt" >= ${today}
        ORDER BY "expiresAt" ASC, "earnedAt" ASC
        FOR UPDATE`,
    );

    if (rows.reduce((sum, row) => sum + row.remainingMinutes, 0) < neededMinutes) return null;

    const usedAt = this.tva.now();
    let remaining = neededMinutes;
    const usedIds: string[] = [];
    for (const row of rows) {
      if (remaining <= 0) break;
      const spent = Math.min(remaining, row.remainingMinutes);
      const left = row.remainingMinutes - spent;
      await tx.compOffCredit.update({
        where: { id: row.id },
        data: left === 0
          ? { remainingMinutes: 0, status: 'USED', usedAt, leaveRequestId }
          : { remainingMinutes: left },
      });
      remaining -= spent;
      usedIds.push(row.id);
    }
    return usedIds;
  }

  /**
   * Backwards-compatible single-credit consumption.
   *
   * @deprecated Use consumeForDays; a leave request spanning several days needs
   * one credit per day, not one credit per request.
   */
  async consumeAvailable(
    tx: Prisma.TransactionClient,
    employeeId: string,
    leaveRequestId: string,
  ) {
    const ids = await this.consumeForDays(tx, employeeId, leaveRequestId, 1);
    if (!ids || ids.length === 0) return null;
    return tx.compOffCredit.findUnique({ where: { id: ids[0] } });
  }
}
