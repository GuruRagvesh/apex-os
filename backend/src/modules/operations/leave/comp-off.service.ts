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
 * A completed day earns one credit when either:
 *  - effective work reaches 9 hours on a Sunday, 2nd/4th Saturday or official
 *    holiday; or
 *  - effective work reaches 12 hours on three consecutive company working
 *    days. Weekly offs and holidays are skipped when finding those three days.
 *
 * Consumption is likewise exact: a leave request for N qualifying days needs N
 * credits, and there is no fallback to Casual or Emergency entitlement.
 */

/** Qualifying weekly-off reasons. A plain working day never earns comp off. */
const QUALIFYING_WEEKLY_OFF = ['SUNDAY', 'SECOND_SATURDAY', 'FOURTH_SATURDAY'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OFF_DAY_MINUTES = 9 * 60;
const LONG_DAY_MINUTES = 12 * 60;

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

  private async workedMinutes(employeeId: string, dates: string[]) {
    const rows = await this.prisma.workSession.findMany({
      where: {
        userId: employeeId,
        date: { in: dates.map((date) => this.tva.companyDateOnly(new Date(`${date}T00:00:00.000Z`))) },
        logoutAt: { not: null },
      },
      select: { date: true, totalWorkMinutes: true },
    });
    const totals = new Map<string, number>();
    for (const row of rows) {
      const key = row.date.toISOString().slice(0, 10);
      totals.set(key, (totals.get(key) ?? 0) + Math.max(0, row.totalWorkMinutes ?? 0));
    }
    return totals;
  }

  private async createAutomaticCredit(
    employeeId: string,
    businessDate: string,
    workSessionId: string,
    rule: 'OFF_DAY_9_HOURS' | 'THREE_WORKING_DAYS_12_HOURS',
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
      message: rule === 'OFF_DAY_9_HOURS'
        ? `You earned one comp-off for working 9 or more hours on ${businessDate}. It expires in ${expiryDays} days.`
        : `You earned one comp-off after three consecutive company working days of 12 or more hours. It expires in ${expiryDays} days.`,
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
    const qualification = await this.qualifyingSourceDay(employeeId, businessDate);
    const currentMinutes = (await this.workedMinutes(employeeId, [businessDate])).get(businessDate) ?? 0;
    if (qualification.qualifies) {
      if (currentMinutes < OFF_DAY_MINUTES) return null;
      return this.createAutomaticCredit(employeeId, businessDate, workSessionId, 'OFF_DAY_9_HOURS');
    }

    // Find the current and two immediately preceding COMPANY WORKING days.
    const workingDates = [businessDate];
    let cursor = businessDate;
    for (let scanned = 0; workingDates.length < 3 && scanned < 14; scanned += 1) {
      cursor = this.shiftDate(cursor, -1);
      if (await this.isCompanyWorkingDay(employeeId, cursor)) workingDates.push(cursor);
    }
    if (workingDates.length < 3) return null;

    const totals = await this.workedMinutes(employeeId, workingDates);
    if (workingDates.some((date) => (totals.get(date) ?? 0) < LONG_DAY_MINUTES)) return null;

    // A credit on either preceding working day means this three-day block has
    // already paid out. This makes days 1-3 one credit, days 4-6 the next,
    // instead of issuing overlapping credits on days 3, 4 and 5.
    const precedingCredit = await this.prisma.compOffCredit.findFirst({
      where: {
        employeeId,
        earnedFromBusinessDate: {
          in: workingDates.slice(1).map((date) => this.tva.companyDateOnly(new Date(`${date}T00:00:00.000Z`))),
        },
      },
      select: { id: true },
    });
    if (precedingCredit) return null;
    return this.createAutomaticCredit(employeeId, businessDate, workSessionId, 'THREE_WORKING_DAYS_12_HOURS');
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
    return this.prisma.compOffCredit.findMany({
      where: { employeeId, status: 'AVAILABLE', expiresAt: { gte: today } },
      orderBy: [{ expiresAt: 'asc' }, { earnedAt: 'asc' }],
    });
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
    const needed = Math.ceil(Math.max(0, requiredDays));
    if (needed === 0) return [];

    const today = this.tva.companyDateOnly(this.tva.now());
    // Oldest-expiring first, deterministically: a credit about to lapse is spent
    // before one with months left, so nobody loses entitlement to ordering luck.
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "comp_off_credits"
        WHERE "employeeId" = ${employeeId}
          AND status = 'AVAILABLE'
          AND "expiresAt" >= ${today}
        ORDER BY "expiresAt" ASC, "earnedAt" ASC
        LIMIT ${needed} FOR UPDATE`,
    );

    if (rows.length < needed) return null;

    const usedAt = this.tva.now();
    await tx.compOffCredit.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: 'USED', usedAt, leaveRequestId },
    });
    return rows.map((r) => r.id);
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
