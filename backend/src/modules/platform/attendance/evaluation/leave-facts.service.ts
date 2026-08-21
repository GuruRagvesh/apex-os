import { Injectable } from '@nestjs/common';
import { LeaveStatus } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import type { LeaveDayFacts } from './daily-attendance.types';

/**
 * Read-only bridge from the existing Leave domain to attendance evaluation
 * (AE-1).
 *
 * This is NOT a second leave system. It creates nothing, approves nothing,
 * deducts nothing and never touches a balance. It answers one question —
 * "what does the Leave domain already PROVE about this employee on this date?"
 * — and returns the proof together with the leave id behind it.
 *
 * The distinction matters because the evaluator is forbidden from inferring
 * loss of pay. LWP is reported here only when the leave record itself says so
 * (LeaveType.UNPAID); a balance that cannot be read is never treated as a
 * balance that is exhausted.
 */
@Injectable()
export class LeaveFactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
  ) {}

  /**
   * Leave facts for one employee on one business date.
   *
   * `startDate`/`endDate` on LeaveRequest are plain DateTime, not @db.Date, so
   * they can carry a time-of-day. The window is therefore normalised against
   * the company day's real bounds rather than compared as bare dates — a leave
   * saved at 09:30 on its start date must still cover that whole date.
   */
  async resolveForDate(userId: string, businessDate: string): Promise<LeaveDayFacts> {
    const dayStart = this.tva.companyDayStart(new Date(`${businessDate}T00:00:00.000Z`));
    const dayEnd = this.tva.companyDayEnd(new Date(`${businessDate}T00:00:00.000Z`));

    // take: 2 — enough to tell 0 from 1 from many, and no more. Overlapping
    // approved leave is a data problem a human must settle, not something to
    // resolve by silently picking the first row.
    const covering = await this.prisma.leaveRequest.findMany({
      where: {
        userId,
        // FINAL approval only. status flips to APPROVED at the HR step, and
        // approvalStage is asserted alongside it so a future path that sets
        // APPROVED without completing the chain still cannot reach attendance.
        // Historical rows were backfilled to COMPLETE by the LH-2 migration.
        status: LeaveStatus.APPROVED,
        approvalStage: 'COMPLETE',
        startDate: { lte: dayEnd },
        endDate: { gte: dayStart },
      },
      orderBy: { createdAt: 'asc' },
      take: 2,
    });

    if (covering.length === 0) {
      return { hasApprovedLeave: false, kind: 'NONE', leaveRequestId: null };
    }

    if (covering.length > 1) {
      return {
        hasApprovedLeave: true,
        kind: 'AMBIGUOUS',
        leaveRequestId: covering[0].id,
      };
    }

    const leave = covering[0];

    // LH-2: an explicit settlement, when one was recorded, is the authority.
    // It says how the company actually funded the leave, which is exactly the
    // question attendance needs answered, and it is a recorded decision rather
    // than an inference from a balance read at some other moment.
    if (leave.fundingOutcome) {
      if (leave.fundingOutcome === 'PARTIAL') {
        // Totals are known; which dates were unpaid is not. Routed to review
        // rather than attributing the unpaid day to an arbitrary date.
        return {
          hasApprovedLeave: true,
          kind: 'PARTIALLY_FUNDED',
          leaveRequestId: leave.id,
          leaveType: leave.type,
          halfDayType: leave.halfDayType ?? null,
        };
      }
      const unpaid = leave.fundingOutcome === 'UNPAID';
      return {
        hasApprovedLeave: true,
        kind: leave.isHalfDay
          ? unpaid
            ? 'HALF_DAY_UNPAID'
            : 'HALF_DAY_PAID'
          : unpaid
            ? 'UNPAID'
            : 'PAID',
        leaveRequestId: leave.id,
        leaveType: leave.type,
        halfDayType: leave.halfDayType ?? null,
      };
    }

    // Legacy rows approved before LH-2 carry no settlement. The requested type
    // is then the only proof available: explicit unpaid leave is LWP, anything
    // else is paid. A balance is never consulted to invent one.
    if (leave.type === 'UNPAID') {
      return {
        hasApprovedLeave: true,
        kind: leave.isHalfDay ? 'HALF_DAY_UNPAID' : 'UNPAID',
        leaveRequestId: leave.id,
        leaveType: leave.type,
        halfDayType: leave.halfDayType ?? null,
      };
    }

    return {
      hasApprovedLeave: true,
      kind: leave.isHalfDay ? 'HALF_DAY_PAID' : 'PAID',
      leaveRequestId: leave.id,
      leaveType: leave.type,
      halfDayType: leave.halfDayType ?? null,
    };
  }
}
