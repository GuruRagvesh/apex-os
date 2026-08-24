import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TVAService } from '../../../common/services/tva.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { BusinessCalendarService } from '../../platform/attendance/calendar/business-calendar.service';
import { EmployeeTimelineService } from '../../platform/attendance/timeline/employee-timeline.service';

/**
 * Comp Off credits.
 *
 * Management confirmed which days EARN comp off — Sunday, 2nd Saturday, 4th
 * Saturday, and official company holidays — but has NOT specified how much work
 * on such a day is required to earn one. So nothing here creates a credit from a
 * WorkSession. A credit exists only because a human granted it, and that grant
 * is audited.
 *
 * Consumption is likewise exact: a leave request for N qualifying days needs N
 * credits, and there is no fallback to Casual or Emergency entitlement.
 */

/** Qualifying weekly-off reasons. A plain working day never earns comp off. */
const QUALIFYING_WEEKLY_OFF = ['SUNDAY', 'SECOND_SATURDAY', 'FOURTH_SATURDAY'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  ) {}

  /** Calendar qualification only. No WorkSession automatically grants credit. */
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
      qualifies: weekly || facts.holiday.isHoliday,
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
    const policy = await this.prisma.leavePolicy.findUnique({
      where: { id: profile.assignedLeavePolicyId },
      select: { compOffExpiryDays: true },
    });
    return policy?.compOffExpiryDays ?? 30;
  }

  /**
   * Grants one comp off credit by hand. HR/Admin only.
   *
   * Deliberately narrow. It proves the source date actually qualifies through
   * BusinessCalendar, refuses an ordinary working day, and checks NOTHING about
   * how long anybody worked — because management has not defined that threshold,
   * and inventing one here would silently become policy.
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
