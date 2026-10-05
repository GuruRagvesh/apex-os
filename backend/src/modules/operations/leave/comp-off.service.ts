import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TVAService } from '../../../common/services/tva.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { BusinessCalendarService } from '../../platform/attendance/calendar/business-calendar.service';
import { EmployeeTimelineService } from '../../platform/attendance/timeline/employee-timeline.service';
import {
  addDays,
  defaultExpiry,
  expiryCeiling,
  mayExtend,
  resolveValidity,
  REFUSAL_REASON,
  type CompOffValidityPolicy,
} from './comp-off-workflow';

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

  /**
   * Who may grant or extend comp off FOR a given employee.
   *
   * HR and Admin anywhere; a MANAGER only inside the departments they actually
   * manage, read from managerDeptAccess plus their own department -- the same
   * primitive every other scoped read uses, so a manager's comp off reach and
   * their team reach cannot drift apart.
   *
   * ENFORCED IN THE SERVICE, NOT THE CONTROLLER, so it cannot be bypassed by
   * reaching the service another way, and so hiding a button is never what is
   * standing between a manager and somebody else's team.
   *
   * TEAM_LEAD IS NOT INCLUDED, and that removes nothing: granting was
   * HR/Admin-only before this, so a team lead never had it. Adding them is a
   * product decision, not a side effect of wiring managers up.
   *
   * A manager granting to THEMSELF is refused. The authority exists to
   * recognise a team member's weekend work, and self-grant is the one shape of
   * it nobody else has reviewed.
   */
  async assertMayManageFor(actor: any, employeeId: string): Promise<void> {
    if (this.accessPolicy.isHrOrAdmin(actor)) return;

    const actorId = actor?.id ?? actor?.sub;
    if (!actorId) throw new ForbiddenException('Not authorized to manage comp off');

    if (actorId === employeeId) {
      throw new ForbiddenException('You cannot grant or extend your own comp off');
    }

    if (this.accessPolicy.roleName(actor) !== 'MANAGER') {
      throw new ForbiddenException('Only a manager or HR can grant or extend comp off');
    }

    const [departmentIds, employee] = await Promise.all([
      this.accessPolicy.managedDepartmentIds(actor),
      this.prisma.user.findUnique({
        where: { id: employeeId },
        select: { id: true, departmentId: true },
      }),
    ]);

    if (!employee) throw new NotFoundException('Employee not found');
    if (!employee.departmentId || !departmentIds.includes(employee.departmentId)) {
      throw new ForbiddenException('That employee is not in a department you manage');
    }
  }

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

  /**
   * Expiry N company-calendar days after a date.
   *
   * KEPT ONLY AS AN ARITHMETIC HELPER. It no longer carries a default, because
   * a default here was one of three copies of the entitlement rule -- the
   * other two sat in expiryDaysFor below. The rule now lives in
   * comp-off-workflow.ts and this does nothing but add days.
   */
  expiresOn(fromBusinessDate: string, expiryDays: number): Date {
    const from = new Date(`${fromBusinessDate}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime())) throw new Error('Invalid business date');
    return addDays(from, expiryDays);
  }

  /**
   * The employee's effective comp off validity policy.
   *
   * Returns the POLICY, not a number, so the one resolver in
   * comp-off-workflow.ts decides what it means. This used to return a number
   * and default it to 30 in two places, which is how one entitlement rule came
   * to have three independent copies and no import linking them.
   *
   * An employee on no leave policy gets an empty policy object rather than an
   * invented figure: defaultExpiry then applies the company fallback, in the
   * one place that fallback is written down.
   */
  private async validityPolicyFor(
    employeeId: string,
    businessDate: string,
  ): Promise<CompOffValidityPolicy> {
    const profile = await this.timeline.findProfileOn(employeeId, businessDate);
    if (!profile?.assignedLeavePolicyId) return {};
    const policy = await this.prisma.leavePolicy.findUnique({
      where: { id: profile.assignedLeavePolicyId },
      select: { compOffExpiryDays: true, compOffMaximumValidityDays: true },
    });
    return {
      defaultValidityDays: policy?.compOffExpiryDays ?? null,
      // Read as well as the default, or expiryCeiling would return null for
      // every policy and mayExtend would refuse every extension with
      // NO_MAXIMUM_CONFIGURED -- a configured ceiling that nothing loads is
      // indistinguishable from no ceiling at all.
      maximumTotalValidityDays: policy?.compOffMaximumValidityDays ?? null,
    };
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
    // HR and Admin anywhere; a manager inside their own departments. Widened
    // from HR-only: a manager is who actually knows their team worked a
    // Sunday, and routing every grant through HR made the recognition slower
    // than the work it recognises.
    await this.assertMayManageFor(actor, input.employeeId);
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
    const validityPolicy = await this.validityPolicyFor(
      input.employeeId,
      input.earnedFromBusinessDate,
    );

    // VALIDITY RUNS FROM THE GRANT, NOT FROM THE DAY WORKED, and this is a
    // change. It used to be measured from earnedFromBusinessDate, which
    // silently shortened every credit by however long the approval took -- a
    // day worked on 10 August and granted on 5 September arrived with most of
    // its life already spent. comp-off-workflow.ts records the decision that
    // validity starts when the credit is granted.
    const grantedOn = this.tva.companyDateOnly(this.tva.now());
    const expiresAt = defaultExpiry(grantedOn, validityPolicy);
    if (!expiresAt) {
      // An incoherent policy. Refused rather than guessed, because a credit
      // whose expiry nobody can defend is worse than no credit.
      throw new BadRequestException(
        resolveValidity(validityPolicy).reason ??
          'This employee comp off validity policy is not configured coherently.',
      );
    }

    let credit;
    try {
      credit = await this.prisma.compOffCredit.create({
        data: {
          employeeId: input.employeeId,
          earnedFromBusinessDate: earnedDate,
          earnedFromWorkSessionId: input.earnedFromWorkSessionId ?? null,
          expiresAt,
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

  /**
   * Moves one credit's expiry forward, never past the ceiling.
   *
   * THE CEILING IS MEASURED FROM THE GRANT, and mayExtend owns that rule. It
   * is the whole value of a maximum: measured from the CURRENT expiry instead,
   * each extension would move its own baseline and a credit could be walked
   * forward indefinitely, one extension at a time, without ever breaching
   * anything.
   *
   * earnedAt IS THE GRANT INSTANT -- it is @default(now()) on the row, set
   * when the credit was created. A separate grantedOn column would be a second
   * copy of the same fact, free to disagree with it.
   *
   * THE AUDIT IS WRITTEN IN THE SAME TRANSACTION AS THE CHANGE, deliberately,
   * and not through eventLogger.log(). That helper swallows its own failures
   * so a logging problem never breaks a user action -- right for a nudge,
   * wrong for an entitlement: an extension whose audit quietly failed is an
   * extension nobody can account for. Here the two commit together or neither
   * does.
   */
  async extendValidity(
    actor: any,
    creditId: string,
    input: { newExpiry: string; reason: string },
  ) {
    const credit = await this.prisma.compOffCredit.findUnique({
      where: { id: creditId },
      select: {
        id: true,
        employeeId: true,
        status: true,
        earnedAt: true,
        expiresAt: true,
        earnedFromBusinessDate: true,
      },
    });
    if (!credit) throw new NotFoundException('Comp off credit not found');

    await this.assertMayManageFor(actor, credit.employeeId);

    const stated = (input?.reason ?? '').trim();
    if (stated.length < 5) {
      throw new BadRequestException('A reason is required to extend a comp off credit');
    }
    if (!DATE_RE.test(input?.newExpiry ?? '')) {
      throw new BadRequestException('newExpiry must be a yyyy-MM-dd date');
    }

    const proposed = new Date(`${input.newExpiry}T00:00:00.000Z`);
    const grantedOn = this.tva.companyDateOnly(credit.earnedAt);
    const policy = await this.validityPolicyFor(
      credit.employeeId,
      credit.earnedFromBusinessDate.toISOString().slice(0, 10),
    );

    const verdict = mayExtend(
      { status: credit.status, grantedOn, currentExpiry: credit.expiresAt },
      proposed,
      policy,
    );
    if (!verdict.allowed) {
      // The workflow's own wording, so the refusal a manager reads is the one
      // the rule actually gave rather than a paraphrase of it.
      throw new BadRequestException(
        verdict.reason ??
          REFUSAL_REASON[verdict.refusal as keyof typeof REFUSAL_REASON] ??
          'This comp off credit cannot be extended',
      );
    }

    const previousExpiry = credit.expiresAt;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.compOffCredit.update({
        where: { id: creditId },
        data: { expiresAt: proposed },
      });

      await (tx as any).operationalEvent.create({
        data: {
          actorId: actor?.id ?? actor?.sub,
          entityType: 'CompOffCredit',
          entityId: creditId,
          action: 'COMP_OFF_EXTENDED',
          // Both expiries, so the history is readable without replaying every
          // row: the ledger is append-only, but expiresAt on the credit is
          // overwritten, and "what was it before" is the question a dispute
          // actually asks.
          beforeValue: { expiresAt: previousExpiry },
          afterValue: { expiresAt: proposed },
          metadata: {
            employeeId: credit.employeeId,
            reason: stated,
            grantedOn,
            ceiling: verdict.ceiling,
          },
        },
      });

      return updated;
    });
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
