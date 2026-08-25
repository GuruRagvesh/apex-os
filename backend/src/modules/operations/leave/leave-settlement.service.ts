import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { LeaveStatus, LeaveType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TVAService } from '../../../common/services/tva.service';
import { LeaveBalanceService } from './leave-balance.service';
import { CompOffService } from './comp-off.service';

/**
 * Funding settlement for an approved leave (LH-2).
 *
 * Answers one question at the moment of FINAL approval: of the days requested,
 * how many can the employee's remaining paid balance actually fund?
 *
 * Two design rules matter here.
 *
 *  1. Settlement happens at HR approval, never at submission. A balance read
 *     when the employee filed the request can be stale by days or weeks, and
 *     acting on it would hand out paid leave the company no longer has.
 *
 *  2. The employee's requested `type` is never rewritten. A request for annual
 *     leave that the company can only half-fund stays a request for annual
 *     leave, with `fundingOutcome = PARTIAL` recording how it was settled.
 */

export type FundingOutcome = 'PAID' | 'UNPAID' | 'PARTIAL';

export interface Settlement {
  fundingOutcome: FundingOutcome;
  paidDays: number;
  unpaidDays: number;
  requestedDays: number;
  balanceBefore: number;
}

@Injectable()
export class LeaveSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly balance: LeaveBalanceService,
    @Optional() private readonly compOff?: CompOffService,
  ) {}

  /**
   * Splits a requested duration against an available balance.
   *
   * Pure arithmetic, separated from the transaction so the rule itself is
   * trivially testable: fully funded, partly funded, or not funded at all.
   */
  split(requestedDays: number, availablePaidDays: number): Settlement {
    const requested = Math.max(0, requestedDays);
    const available = Math.max(0, availablePaidDays);
    const paidDays = Math.min(requested, available);
    const unpaidDays = Number((requested - paidDays).toFixed(2));

    const fundingOutcome: FundingOutcome =
      paidDays <= 0 ? 'UNPAID' : unpaidDays <= 0 ? 'PAID' : 'PARTIAL';

    return {
      fundingOutcome,
      paidDays: Number(paidDays.toFixed(2)),
      unpaidDays,
      requestedDays: requested,
      balanceBefore: available,
    };
  }

  /**
   * Paid days already committed for this employee in a year.
   *
   * Prefers the explicit `paidDays` recorded by a V2 settlement. Legacy rows
   * approved before LH-2 never recorded one, so their computed duration is the
   * only evidence available and is used as a fallback — noted rather than
   * hidden, because it is the one place a historical row is re-measured.
   */
  async consumedPaidDays(
    tx: Prisma.TransactionClient,
    userId: string,
    year: number,
    excludeLeaveId?: string,
    leaveType?: LeaveType,
  ): Promise<number> {
    const bounds = this.tva.financialYearBounds(`${year}-${year + 1}`);
    const approved = await tx.leaveRequest.findMany({
      where: {
        userId,
        status: LeaveStatus.APPROVED,
        startDate: {
          gte: this.tva.companyDayStart(bounds.start),
          lte: this.tva.companyDayEnd(bounds.end),
        },
        ...(excludeLeaveId ? { id: { not: excludeLeaveId } } : {}),
        ...(leaveType ? { type: leaveType } : {}),
      },
    });

    let total = 0;
    for (const row of approved) {
      if (typeof row.paidDays === 'number') {
        total += row.paidDays;
        continue;
      }
      total += await this.balance.getDurationForRequest(
        row.startDate,
        row.endDate,
        row.isHalfDay,
        userId,
      );
    }
    return total;
  }

  /**
   * Settles and finalises one leave request inside a single serialized
   * transaction.
   *
   * The locking order is the whole point:
   *
   *   1. Lock the leave request, so two approvals of the SAME request cannot
   *      both proceed.
   *   2. Re-read it after the lock and re-check the stage, because the row may
   *      have moved while this call waited.
   *   3. Lock the USER row. That is the balance serialization authority: two
   *      different requests for the same employee serialize on it, so they
   *      cannot both read "1 day remaining" and both consume it.
   *
   * A transaction alone would not prevent that second case — both reads would
   * simply see the pre-approval snapshot.
   */
  async settleAndApprove(input: {
    leaveId: string;
    hrApproverId: string;
  }): Promise<{ leave: any; settlement: Settlement }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Serialize on the request itself.
      await tx.$queryRaw`SELECT id FROM "leave_requests" WHERE id = ${input.leaveId} FOR UPDATE`;

      // 2. Re-read AFTER the lock. Anything read before it is a stale snapshot.
      const leave = await tx.leaveRequest.findUnique({ where: { id: input.leaveId } });
      if (!leave) throw new NotFoundException('Leave request not found');
      if (leave.status !== LeaveStatus.PENDING) {
        throw new ForbiddenException('Only pending leave requests can be approved');
      }
      if (leave.approvalStage !== 'HR_REVIEW') {
        throw new ForbiddenException(
          'This request has not completed reporting-manager review yet',
        );
      }

      // 3. Serialize every balance decision for this employee.
      await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${leave.userId} FOR UPDATE`;

      const requestedDays = await this.balance.getDurationForRequest(
        leave.startDate,
        leave.endDate,
        leave.isHalfDay,
        leave.userId,
      );

      let settlement: Settlement;
      if (leave.type === LeaveType.COMP_OFF) {
        // Half-day comp off is refused because management defined comp off in
        // whole earned days and never defined a half credit. Inventing one here
        // would quietly become policy.
        if (leave.isHalfDay) {
          throw new ForbiddenException('Comp Off requests must cover whole working days');
        }
        if (requestedDays < 1) {
          throw new ForbiddenException('Comp Off requests must cover at least one working day');
        }
        if (!this.compOff) {
          throw new ForbiddenException('Comp Off settlement is unavailable');
        }

        // N qualifying leave-days costs N credits. All-or-nothing: an employee
        // with one credit cannot have a two-day request settled as fully funded,
        // and no credit is spent unless the whole request can be covered.
        const consumed = await this.compOff.consumeForDays(
          tx,
          leave.userId,
          leave.id,
          requestedDays,
        );
        if (!consumed) {
          throw new ForbiddenException(
            `This request needs ${requestedDays} unexpired Comp Off credit(s), ` +
              'and the employee does not have enough. There is no fallback to ' +
              'Casual or Emergency leave.',
          );
        }
        // Comp off is its own entitlement: fully funded by credits, never drawn
        // from a paid-leave balance.
        settlement = this.split(requestedDays, requestedDays);
      } else {
        const year = this.tva.financialYear(leave.startDate).startYear;
        // Casual and Emergency are independent management entitlements. All
        // legacy leave types retain the pre-extension shared-pool behaviour.
        const entitlementType =
          leave.type === LeaveType.CASUAL || leave.type === LeaveType.EMERGENCY
            ? leave.type
            : undefined;
        const allocation = await this.balance.getYearlyAllocation(
          leave.userId,
          year,
          entitlementType,
        );
        const consumed = await this.consumedPaidDays(
          tx,
          leave.userId,
          year,
          leave.id,
          entitlementType,
        );
        settlement = this.split(requestedDays, allocation - consumed);
      }
      const now = this.tva.now();

      const updated = await tx.leaveRequest.update({
        where: { id: leave.id },
        data: {
          status: LeaveStatus.APPROVED,
          approvalStage: 'COMPLETE',
          hrApprovedById: input.hrApproverId,
          hrApprovedAt: now,
          // Compatibility fields carry the FINAL approval, so every existing
          // reader of approvedBy/approvedAt keeps seeing what it expects.
          approvedBy: input.hrApproverId,
          approvedAt: now,
          fundingOutcome: settlement.fundingOutcome,
          paidDays: settlement.paidDays,
          unpaidDays: settlement.unpaidDays,
        },
      });

      return { leave: updated, settlement };
    });
  }
}
