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
        // APPROVED is the terminal approved state in the current Leave model.
        // There is no separate HR stage in the schema today (see the AE-1
        // report); if one is added, this single predicate is what changes.
        status: LeaveStatus.APPROVED,
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

    // Explicit unpaid leave is the ONLY thing in the current model that proves
    // loss of pay. LeavePolicy.lwpAfterBalanceExhausted exists, but the request
    // flow rejects a submission that exceeds the balance, so an over-balance
    // approved leave cannot arise through the normal path — and guessing LWP
    // from a balance calculation would be exactly the inference this wave
    // forbids.
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
