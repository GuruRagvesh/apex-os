import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { LeaveStatus, LeaveType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TVAService } from '../../../common/services/tva.service';
import { LeaveBalanceService } from './leave-balance.service';
import { CompOffService } from './comp-off.service';
import { LeavePolicyUnresolvedError } from './leave-balance.service';
import { LeaveCalendarUnresolvedError } from './leave-working-day.service';
import { bucketOf, type PaidBucket } from './leave-rules';

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
   * Paid days already committed for this employee in a year, for one bucket.
   *
   * Prefers the explicit `paidDays` recorded by a settlement. Legacy rows
   * approved before LH-2 never recorded one, so their computed duration is the
   * only evidence available. Phase 3: rows are grouped by PAID BUCKET (see
   * bucketOf), so historical EMERGENCY days draw Sick one-for-one.
   */
  async consumedPaidDays(
    tx: Prisma.TransactionClient,
    userId: string,
    year: number,
    excludeLeaveId?: string,
    leaveType?: LeaveType | PaidBucket,
    window?: { start: Date; end: Date },
  ): Promise<number> {
    const bounds = this.tva.financialYearBounds(`${year}-${year + 1}`);
    const bucket = leaveType ? bucketOf({ type: leaveType }) : null;
    const approved = await tx.leaveRequest.findMany({
      where: {
        userId,
        status: LeaveStatus.APPROVED,
        startDate: {
          gte: this.tva.companyDayStart(window?.start ?? bounds.start),
          lte: this.tva.companyDayEnd(window?.end ?? bounds.end),
        },
        ...(excludeLeaveId ? { id: { not: excludeLeaveId } } : {}),
      },
    });

    let total = 0;
    for (const row of approved) {
      // Comp Off and Unpaid never consume paid entitlement.
      if (row.type === LeaveType.COMP_OFF || row.type === LeaveType.UNPAID) continue;
      if (bucket && bucketOf(row) !== bucket) continue;
      if (typeof row.paidDays === 'number') {
        total += row.paidDays;
        continue;
      }
      // An approved request still awaiting setup has no settlement yet and
      // consumes nothing until it is settled.
      if ((row as any).setupStatus === 'POLICY_SETUP_PENDING') continue;
      try {
        total += await this.balance.getDurationForRequest(row.startDate, row.endDate, row.isHalfDay, userId);
      } catch {
        // Unmeasurable legacy row: counted by HR review, not guessed here.
      }
    }
    return total;
  }

  /**
   * Computes the funding of one request inside the caller's transaction, with
   * the user row already locked. Null when it cannot be computed yet (calendar
   * or leave policy still unresolved): the request is then approved with its
   * settlement left open, and resettleApproved() settles it later.
   */
  private async computeSettlement(tx: Prisma.TransactionClient, leave: any): Promise<Settlement | null> {
    let requestedDays: number;
    try {
      requestedDays = await this.balance.getDurationForRequest(leave.startDate, leave.endDate, leave.isHalfDay, leave.userId);
    } catch (error) {
      if (error instanceof LeaveCalendarUnresolvedError) return null;
      throw error;
    }

    if (leave.type === LeaveType.COMP_OFF) {
      // Comp off is whole earned days, never half, and never falls back to a
      // paid bucket.
      if (leave.isHalfDay) throw new ForbiddenException('Comp Off requests must cover whole working days');
      if (requestedDays < 1) throw new ForbiddenException('Comp Off requests must cover at least one working day');
      if (!this.compOff) throw new ForbiddenException('Comp Off settlement is unavailable');
      const consumed = await this.compOff.consumeForDays(tx, leave.userId, leave.id, requestedDays);
      if (!consumed) {
        throw new ForbiddenException(
          `This request needs ${requestedDays} unexpired Comp Off credit(s), ` +
            'and the employee does not have enough. There is no fallback to Casual or Sick leave.',
        );
      }
      return this.split(requestedDays, requestedDays);
    }

    const bucket = bucketOf(leave);
    // Unpaid leave is unpaid by request; nothing is drawn from a bucket.
    if (!bucket) return this.split(requestedDays, 0);

    const year = this.tva.financialYear(leave.startDate).startYear;
    let allocation: number;
    try {
      allocation = await this.balance.getYearlyAllocation(leave.userId, year, bucket, leave.startDate);
    } catch (error) {
      if (error instanceof LeavePolicyUnresolvedError) return null;
      throw error;
    }
    const consumed = await this.consumedPaidDays(tx, leave.userId, year, leave.id, bucket);
    return this.split(requestedDays, allocation - consumed);
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
   * `routed` (Phase 3): the request's single routed approver completes it from
   * MANAGER_REVIEW in one step. Otherwise the legacy LH-2 HR final step from
   * HR_REVIEW. When the settlement cannot be computed yet (setup pending) the
   * request is still approved -- attendance is protected -- and its funding is
   * left open, excluded from payroll until resettleApproved() settles it.
   */
  async settleAndApprove(input: {
    leaveId: string;
    hrApproverId?: string;
    approverId?: string;
    routed?: boolean;
  }): Promise<{ leave: any; settlement: Settlement | null }> {
    const approverId = input.approverId ?? input.hrApproverId;
    if (!approverId) throw new ForbiddenException('An approver is required');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "leave_requests" WHERE id = ${input.leaveId} FOR UPDATE`;
      const leave = await tx.leaveRequest.findUnique({ where: { id: input.leaveId } });
      if (!leave) throw new NotFoundException('Leave request not found');
      if (leave.status !== LeaveStatus.PENDING) {
        throw new ForbiddenException('Only pending leave requests can be approved');
      }
      const expectedStage = input.routed ? 'MANAGER_REVIEW' : 'HR_REVIEW';
      if (leave.approvalStage !== expectedStage) {
        throw new ForbiddenException(
          input.routed
            ? 'This request is not awaiting its approver'
            : 'This request has not completed reporting-manager review yet',
        );
      }

      await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${leave.userId} FOR UPDATE`;

      const settlement = await this.computeSettlement(tx, leave);
      const now = this.tva.now();

      const updated = await tx.leaveRequest.update({
        where: { id: leave.id },
        data: {
          status: LeaveStatus.APPROVED,
          approvalStage: 'COMPLETE',
          ...(input.routed
            ? { managerApprovedById: approverId, managerApprovedAt: now }
            : { hrApprovedById: approverId, hrApprovedAt: now }),
          // Compatibility fields carry the FINAL approval.
          approvedBy: approverId,
          approvedAt: now,
          fundingOutcome: settlement?.fundingOutcome ?? null,
          paidDays: settlement?.paidDays ?? null,
          unpaidDays: settlement?.unpaidDays ?? null,
          // A request that could not be settled stays visibly setup-pending.
          ...(settlement ? {} : { setupStatus: 'POLICY_SETUP_PENDING' as any }),
        },
      });

      return { leave: updated, settlement };
    });
  }

  /**
   * Settles APPROVED requests that were approved while setup was pending,
   * now that configuration may be fixed. Idempotent: rows that still cannot be
   * settled are left as they are; settled rows are never revisited.
   */
  async resettleApproved(userId?: string): Promise<{ settled: string[]; stillPending: number }> {
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        status: LeaveStatus.APPROVED,
        setupStatus: 'POLICY_SETUP_PENDING',
        fundingOutcome: null,
        ...(userId ? { userId } : {}),
      },
      select: { id: true },
    });
    const settled: string[] = [];
    let stillPending = 0;
    for (const row of rows) {
      const done = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "leave_requests" WHERE id = ${row.id} FOR UPDATE`;
        const leave = await tx.leaveRequest.findUnique({ where: { id: row.id } });
        if (!leave || leave.status !== LeaveStatus.APPROVED || leave.fundingOutcome) return false;
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${leave.userId} FOR UPDATE`;
        const settlement = await this.computeSettlement(tx, leave);
        if (!settlement) return false;
        await tx.leaveRequest.update({
          where: { id: leave.id },
          data: {
            fundingOutcome: settlement.fundingOutcome,
            paidDays: settlement.paidDays,
            unpaidDays: settlement.unpaidDays,
            setupStatus: 'RESOLVED',
          },
        });
        return true;
      });
      if (done) settled.push(row.id);
      else stillPending += 1;
    }
    return { settled, stillPending };
  }
}
