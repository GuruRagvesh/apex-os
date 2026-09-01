import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { EventLoggerService } from '../../../../common/services/event-logger.service';
import { DailyAttendanceEvaluatorService } from '../evaluation/daily-attendance-evaluator.service';
import { LeaveFactsService } from '../evaluation/leave-facts.service';
import {
  assessSettlement,
  businessMonthOf,
  SettledAttendanceError,
} from '../evaluation/attendance-settlement';
import { lockAttendanceMonth } from '../evaluation/attendance-month-lock';
import { buildCorrectionRecord } from '../regularization/correction-proposal';

/**
 * Approving an import, then applying it.
 *
 * Two actions, deliberately. Approval records that a human looked at the
 * comparison and accepted it. Apply executes that decision against whatever is
 * true at the moment of execution -- which is not necessarily what the human
 * saw, and the gap between those two is where an import can do damage.
 *
 * A PERSISTED PREVIEW IS NOT PERMISSION TO WRITE. Every applicable row is
 * re-checked against authoritative state inside the lock that protects it:
 * the attendance fingerprint, the settlement of the day and its month, whether
 * a correction has since been raised, and whether the leave a LEAVE row leans
 * on still exists. A row whose world moved is SKIPPED_STALE, never forced.
 *
 * And nothing here writes DailyAttendance. Each applied row becomes an
 * AttendanceRegularization and goes through reviseForApprovedCorrection(), the
 * one engine allowed to revise an official attendance fact.
 */

/** Statuses that mean a correction is still unsettled. */
const OPEN_CORRECTION_STATUSES = ['PENDING', 'MANAGER_APPROVED'] as const;

/**
 * Applicable rows per transaction.
 *
 * Small on purpose. Each row runs the evaluator and holds a month lock, and a
 * long transaction blocks the payroll close for that month; a failure also
 * costs only the chunk. Each employee-day is still atomic in its own right.
 */
const APPLY_CHUNK = 25;

export interface ApplySummary {
  reference: string;
  status: string;
  attempted: number;
  applied: number;
  stale: number;
  failed: number;
  noOps: number;
}

@Injectable()
export class AttendanceImportApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly eventLogger: EventLoggerService,
    private readonly evaluator: DailyAttendanceEvaluatorService,
    private readonly leaveFacts: LeaveFactsService,
  ) {}

  private actorId(actor: any): string {
    const id = actor?.id ?? actor?.sub;
    if (!id) throw new ForbiddenException('Not authenticated');
    return id;
  }

  private assertHrAuthority(actor: any, action: string) {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException(`Only HR or an administrator can ${action} an attendance import.`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Approve
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Records the human decision. Writes no attendance and creates no correction.
   *
   * Approval is authorisation to attempt an apply; it is not the apply. Keeping
   * them apart is what makes the apply-time re-check meaningful -- if approval
   * wrote the records, there would be no later moment at which to notice that
   * the world had moved.
   */
  async approve(actor: any, batchId: string) {
    this.assertHrAuthority(actor, 'approve');
    const approverId = this.actorId(actor);

    return this.prisma.$transaction(async (tx) => {
      // Serialized so two approvers cannot both move the batch out of review.
      await tx.$queryRaw`SELECT id FROM "attendance_import_batches" WHERE id = ${batchId} FOR UPDATE`;

      const batch = await tx.attendanceImportBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Import batch not found');

      if (batch.status !== 'READY_FOR_REVIEW') {
        throw new ForbiddenException(
          `This batch is ${batch.status.toLowerCase().replace(/_/g, ' ')} and cannot be approved.`,
        );
      }

      // MAKER/CHECKER. Also a database CHECK constraint -- an import can rewrite
      // months of attendance, and this should hold against a code path that
      // forgets to ask.
      if (batch.uploadedById === approverId) {
        throw new ForbiddenException(
          'An import must be approved by somebody other than the person who uploaded it.',
        );
      }

      // RECOMPUTED FROM THE ROWS, never trusted from a client or a cached count.
      const [invalid, conflict, applicable] = await Promise.all([
        tx.attendanceImportRow.count({ where: { batchId, classification: 'INVALID' } }),
        tx.attendanceImportRow.count({ where: { batchId, classification: 'CONFLICT' } }),
        tx.attendanceImportRow.count({
          where: { batchId, classification: { in: ['NEW', 'CHANGE'] } },
        }),
      ]);

      if (invalid > 0 || conflict > 0) {
        throw new BadRequestException(
          `This batch still has ${invalid} invalid and ${conflict} conflicting row(s). ` +
            'Fix the file and upload it again, so nothing is applied while something known-bad is skipped.',
        );
      }
      if (applicable === 0) {
        throw new BadRequestException('Every row already matches Apex OS. There is nothing to apply.');
      }

      // AN APPROVER MAY NOT APPROVE THEIR OWN ATTENDANCE.
      //
      // Somebody signing off a change to their own record is the one review
      // that reviews nothing. The batch is refused rather than the row silently
      // dropped: quietly excluding it would apply a batch the approver believes
      // they approved in full.
      const own = await tx.attendanceImportRow.count({
        where: { batchId, userId: approverId, classification: { in: ['NEW', 'CHANGE'] } },
      });
      if (own > 0) {
        throw new ForbiddenException(
          `This batch changes your own attendance on ${own} day(s). Another authorised approver must handle it.`,
        );
      }

      const approved = await tx.attendanceImportBatch.update({
        where: { id: batchId },
        data: { status: 'APPROVED', approvedById: approverId, approvedAt: this.tva.now() },
      });

      this.eventLogger
        .log({
          actorId: approverId,
          entityType: 'AttendanceImportBatch',
          entityId: batchId,
          action: 'ATTENDANCE_IMPORT_APPROVED' as any,
          fromState: 'READY_FOR_REVIEW',
          toState: 'APPROVED',
          metadata: {
            reference: batch.reference,
            mode: batch.mode,
            uploadedById: batch.uploadedById,
            applicableRows: applicable,
          },
        })
        .catch(() => {});

      return approved;
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Apply
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Executes an approved batch.
   *
   * Any authorised HR actor may execute; maker/checker has already been
   * satisfied at approval, and requiring the same person to be present twice
   * buys nothing while making a handover impossible. All three actors are
   * recorded separately.
   */
  async apply(actor: any, batchId: string): Promise<ApplySummary> {
    this.assertHrAuthority(actor, 'apply');
    const applierId = this.actorId(actor);

    // ── Claim the batch. Exactly one process may do this. ─────────────────
    const claimed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "attendance_import_batches" WHERE id = ${batchId} FOR UPDATE`;

      const batch = await tx.attendanceImportBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Import batch not found');
      if (batch.status !== 'APPROVED') {
        // A deterministic refusal, not a second set of corrections. This is
        // what a double click and two open browsers both hit.
        throw new ForbiddenException(
          `This batch is ${batch.status.toLowerCase().replace(/_/g, ' ')} and cannot be applied.`,
        );
      }

      return tx.attendanceImportBatch.update({
        where: { id: batchId },
        data: { status: 'APPLYING', appliedById: applierId },
      });
    });

    this.eventLogger
      .log({
        actorId: applierId,
        entityType: 'AttendanceImportBatch',
        entityId: batchId,
        action: 'ATTENDANCE_IMPORT_APPLY_STARTED' as any,
        fromState: 'APPROVED',
        toState: 'APPLYING',
        metadata: { reference: claimed.reference, approvedById: claimed.approvedById },
      })
      .catch(() => {});

    // Only rows that would change something. MATCH rows are truthful no-ops and
    // are never touched: calling them APPLIED would claim a revision that never
    // happened.
    const rows = await this.prisma.attendanceImportRow.findMany({
      where: { batchId, classification: { in: ['NEW', 'CHANGE'] }, applyState: 'PENDING' },
      orderBy: [{ businessDate: 'asc' }, { rowNumber: 'asc' }],
    });
    const noOps = await this.prisma.attendanceImportRow.count({
      where: { batchId, classification: 'MATCH' },
    });

    let applied = 0;
    let stale = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += APPLY_CHUNK) {
      for (const row of rows.slice(i, i + APPLY_CHUNK)) {
        const outcome = await this.applyRow(row, claimed, applierId);
        if (outcome === 'APPLIED') applied += 1;
        else if (outcome === 'SKIPPED_STALE') stale += 1;
        else failed += 1;
      }
    }

    // A zero-success batch is not APPLIED. Reporting it as such would tell HR
    // the import went through when nothing did.
    const status =
      applied === rows.length && failed === 0 && stale === 0
        ? 'APPLIED'
        : applied > 0
          ? 'PARTIALLY_APPLIED'
          : 'FAILED';

    const finished = await this.prisma.attendanceImportBatch.update({
      where: { id: batchId },
      data: {
        status: status as any,
        appliedAt: this.tva.now(),
        appliedRows: applied,
        failedRows: failed + stale,
        failureReason:
          status === 'FAILED'
            ? 'No row could be applied: every one was refused at apply time or failed.'
            : null,
      },
    });

    this.eventLogger
      .log({
        actorId: applierId,
        entityType: 'AttendanceImportBatch',
        entityId: batchId,
        action: `ATTENDANCE_IMPORT_${status}` as any,
        fromState: 'APPLYING',
        toState: status,
        metadata: {
          reference: finished.reference,
          attempted: rows.length,
          applied,
          stale,
          failed,
          noOps,
        },
      })
      .catch(() => {});

    return {
      reference: finished.reference,
      status,
      attempted: rows.length,
      applied,
      stale,
      failed,
      noOps,
    };
  }

  /**
   * One employee-day, atomically.
   *
   * The correction, the official revision and the import row's link all commit
   * together or not at all. There is no state in which attendance was revised
   * while the row still says PENDING, or the row says APPLIED while nothing was
   * written -- which is what makes a FAILED row safe to investigate: no
   * revision committed.
   */
  private async applyRow(
    row: any,
    batch: any,
    applierId: string,
  ): Promise<'APPLIED' | 'SKIPPED_STALE' | 'FAILED'> {
    const businessDate = this.tva.companyBusinessDate(row.businessDate);

    try {
      await this.prisma.$transaction(async (tx) => {
        // The Phase 2B lock, shared rather than reimplemented. Held before
        // anything is read, so a month finalized between the read and the write
        // cannot slip through.
        await lockAttendanceMonth(tx, businessMonthOf(businessDate));

        await tx.$queryRaw`SELECT id FROM "daily_attendance" WHERE "userId" = ${row.userId} AND "date" = ${row.businessDate}::date FOR UPDATE`;

        const current = await tx.dailyAttendance.findUnique({
          where: { userId_date: { userId: row.userId, date: row.businessDate } },
        });

        // ── HAS THE WORLD MOVED SINCE THE PREVIEW HR APPROVED? ────────────
        //
        // A persisted preview is a record of what somebody was shown, not a
        // licence to write. Each of these is a reason the approval no longer
        // describes reality.
        const fingerprintMoved =
          (current?.sourceFingerprint ?? null) !== (row.currentFingerprint ?? null);
        if (fingerprintMoved) throw new StaleRow('The attendance record changed after this import was approved.');

        const monthClose = await tx.attendanceMonthClose.findUnique({
          where: { month: businessMonthOf(businessDate) },
          select: { status: true },
        });
        const settlement = assessSettlement(
          { day: current, monthClose },
          'BULK_IMPORT',
        );
        if (settlement.blocked.length > 0) {
          throw new StaleRow('This period was closed after the import was approved.');
        }

        const openCorrection = await tx.attendanceRegularization.findFirst({
          where: {
            userId: row.userId,
            date: row.businessDate,
            status: { in: [...OPEN_CORRECTION_STATUSES] },
          },
          select: { id: true },
        });
        if (openCorrection) {
          throw new StaleRow('A correction for this day was raised after the import was approved.');
        }

        // Leave authority is re-asked, never assumed from the preview. An
        // import may not manufacture a LEAVE day the leave module does not
        // support, and approval does not freeze that fact.
        if (row.proposedStatus === 'LEAVE' || row.proposedStatus === 'LWP') {
          const leave = await this.leaveFacts.resolveForDate(row.userId, businessDate);
          if (!leave || leave.kind === 'NONE') {
            throw new StaleRow('The approved leave behind this row no longer exists.');
          }
        }

        // ── The one authoritative path ────────────────────────────────────
        const correction = await tx.attendanceRegularization.create({
          data: {
            ...(buildCorrectionRecord({
              userId: row.userId,
              date: row.businessDate,
              proposal: {
                punchInAt: row.proposedPunchIn,
                punchOutAt: row.proposedPunchOut,
                proposedStatus: row.proposedStatus,
                reason: row.normalizedReason ?? '',
              },
              official: current,
              // The batch's mode, carried onto every correction it produces, so
              // a reconstruction of a period Apex OS was not running for stays
              // distinguishable from a correction of one it was.
              entrySource: batch.mode === 'HISTORICAL_MIGRATION' ? 'HISTORICAL_IMPORT' : 'BULK_IMPORT',
              requestType: 'MISSING_PUNCH',
              // The uploader supplied the proposal; the approver sanctioned it;
              // the applier executed it. Three responsibilities, recorded
              // separately rather than blurred into one convenient actor.
              createdById: batch.uploadedById,
              actorRoleAtEntry: 'IMPORT',
            }) as any),

            // Batch approval IS the review, and is recorded as exactly that.
            // No manager stage is invented: pretending each of six thousand
            // rows was individually reviewed would make the audit less true,
            // not more.
            status: 'HR_APPROVED',
            hrApproverId: batch.approvedById,
            hrDecisionAt: this.tva.now(),
          },
        });

        await this.evaluator.reviseForApprovedCorrection(
          tx,
          row.userId,
          businessDate,
          correction.id,
          { authority: 'BULK_IMPORT' },
        );

        // Written in the same transaction as the revision it describes.
        await tx.attendanceImportRow.update({
          where: { id: row.id },
          data: {
            applyState: 'APPLIED',
            appliedAt: this.tva.now(),
            regularizationId: correction.id,
            failureReason: null,
          },
        });
      });

      return 'APPLIED';
    } catch (error: any) {
      const isStale = error instanceof StaleRow || error instanceof SettledAttendanceError;

      await this.prisma.attendanceImportRow
        .update({
          where: { id: row.id },
          data: {
            applyState: isStale ? 'SKIPPED_STALE' : 'FAILED',
            failureReason: String(error?.message ?? error).slice(0, 500),
          },
        })
        .catch(() => {});

      return isStale ? 'SKIPPED_STALE' : 'FAILED';
    }
  }
}

/**
 * The row was fine when it was approved and is not fine now.
 *
 * Its own type so it can be told from a genuine failure: a stale row is the
 * system working, and re-previewing resolves it, where a failure wants
 * investigating.
 */
export class StaleRow extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleRow';
  }
}
