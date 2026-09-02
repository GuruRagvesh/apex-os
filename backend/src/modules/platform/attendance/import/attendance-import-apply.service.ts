import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
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
import { classifyRow } from './import-classify';

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

/**
 * How long an apply lease stays fresh without a heartbeat.
 *
 * Long enough that an ordinary chunk cannot look dead -- a chunk of 25 rows,
 * each running the evaluator, is seconds -- and short enough that a genuine
 * crash does not strand a batch for an afternoon. Nothing resumes when it
 * expires; expiry only makes an explicit, human-initiated resume permissible.
 */
const APPLY_LEASE_MS = 2 * 60 * 1000;

/**
 * Longest a healthy run may go without proving it is alive.
 *
 * Chosen against the lease, not against a guess about chunk duration. The
 * heartbeat is checked after EVERY row, so the worst gap is one row's
 * transaction plus this interval -- for a live worker to be mistaken for a dead
 * one, a single employee-day would have to take a minute and a half, which is
 * far beyond any transaction this code would let stand.
 *
 * Beating between chunks alone was not enough: a chunk is a variable amount of
 * work, and "twenty-five rows always finish inside two minutes" is an
 * assumption rather than a bound.
 */
const HEARTBEAT_INTERVAL_MS = 20 * 1000;

/**
 * What a finished batch is called.
 *
 * The row-level and batch-level meanings of APPLIED are deliberately different,
 * and conflating them was a real bug: a row is APPLIED when it produced an
 * authoritative revision, and a BATCH is APPLIED when it was fully processed
 * with nothing left to do. A file whose four thousand rows all MATCH is a
 * completely successful reconciliation -- reporting it as FAILED would tell HR
 * the opposite of what happened.
 *
 * Staleness is likewise not failure. It means the system refused to write
 * against an approval that no longer describes reality, which is the guard
 * working; the answer is to re-preview, not to debug.
 */
export function batchOutcome(counts: {
  /** Every row the file produced. An empty batch is not a quiet success. */
  totalRows: number;
  invalid: number;
  conflict: number;
  actionable: number;
  applied: number;
  stale: number;
  failed: number;
}): 'APPLIED' | 'PARTIALLY_APPLIED' | 'REVIEW_REQUIRED' | 'FAILED' {
  const { totalRows, invalid, conflict, actionable, applied, stale, failed } = counts;

  // AN EMPTY BATCH IS NOT A SUCCESSFUL ONE.
  //
  // "Nothing to do" and "there was never anything here" produce the same
  // actionable count and mean opposite things. Taking totalRows rather than
  // trusting the caller to have checked is the difference between a rule and
  // an assumption -- a file that parsed to nothing must never report APPLIED.
  if (totalRows === 0) return 'FAILED';

  // Approval already refuses these, so reaching here means something upstream
  // let a known-bad batch through. Fail rather than paper over it.
  if (invalid > 0 || conflict > 0) return 'FAILED';

  // Nothing to do, and nothing went wrong: every row already agreed with Apex
  // OS. A four-thousand-row file that all MATCHes lands here, and it is a
  // completely successful reconciliation.
  if (actionable === 0) return 'APPLIED';
  if (applied === actionable) return 'APPLIED';
  if (applied > 0) return 'PARTIALLY_APPLIED';

  // Nothing applied. Which of the two reasons decides the name.
  if (failed === 0 && stale > 0) return 'REVIEW_REQUIRED';
  return 'FAILED';
}

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
      // A batch where every row already agrees is APPROVABLE, deliberately.
      //
      // This used to be refused as "nothing to apply". Three things were wrong
      // with that. It left a fully reconciled batch stuck in READY_FOR_REVIEW,
      // which is not what it was; it made the all-MATCH success outcome in
      // batchOutcome() unreachable, so a rule we rely on was never exercised;
      // and it drew the line in an indefensible place -- 99 MATCH plus one
      // CHANGE was allowed through, while 100 MATCH, the strictly safer file,
      // was not.
      //
      // An all-MATCH result is also the outcome a reconciliation run hopes for:
      // "the biometric export agrees with Apex OS on every day". That deserves
      // to be recorded, with who checked it and when, rather than refused.
      // It applies as APPLIED with applied = 0 and noOps = N, and writes nothing.

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
      if (batch.status === 'APPLYING' && this.leaseIsFresh(batch)) {
        // Somebody is running it right now. A deterministic refusal, not a
        // second set of corrections against the same rows.
        throw new ConflictException(
          `This batch is already being applied (attempt ${batch.applyAttemptId}). ` +
            'Wait for it to finish, or resume it if that run has died.',
        );
      }
      if (batch.status !== 'APPROVED') {
        throw new ForbiddenException(
          batch.status === 'REVIEW_REQUIRED'
            ? 'The facts changed after this batch was approved. Re-preview it and approve again before applying.'
            : `This batch is ${batch.status.toLowerCase().replace(/_/g, ' ')} and cannot be applied.`,
        );
      }

      return tx.attendanceImportBatch.update({
        where: { id: batchId },
        data: {
          status: 'APPLYING',
          appliedById: applierId,
          // The lease. A fresh heartbeat is what refuses a second caller;
          // without it APPLYING says only "somebody started this", and the
          // safe responses to that are to block the batch forever or to let a
          // second worker run beside the first.
          applyAttemptId: randomUUID(),
          applyStartedAt: this.tva.now(),
          applyHeartbeatAt: this.tva.now(),
        },
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

    return this.processRows(claimed, applierId);
  }

  /**
   * The row loop, shared by a first apply and a resume.
   *
   * One implementation, so a resumed batch is held to exactly the same
   * re-checks, chunking and outcome rules as a first run.
   */
  private async processRows(claimed: any, applierId: string): Promise<ApplySummary> {
    const batchId = claimed.id;

    // Only rows that would change something. MATCH rows are truthful no-ops and
    // are never touched: calling them APPLIED would claim a revision that never
    // happened. SKIPPED_STALE rows are excluded too -- they were refused
    // because the facts moved, and only a fresh preview and approval brings
    // them back.
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
    let lastBeat = this.tva.now().getTime();

    outer: for (let i = 0; i < rows.length; i += APPLY_CHUNK) {
      for (const row of rows.slice(i, i + APPLY_CHUNK)) {
        const outcome = await this.applyRow(row, claimed, applierId);
        if (outcome === 'APPLIED') applied += 1;
        else if (outcome === 'SKIPPED_STALE') stale += 1;
        else if (outcome === 'LOST_OWNERSHIP') {
          // Somebody else legitimately took this batch over while we were
          // working. Stop immediately and write nothing further -- including
          // the batch status, which now belongs to them.
          return {
            reference: claimed.reference,
            status: 'SUPERSEDED',
            attempted: applied + stale + failed,
            applied,
            stale,
            failed,
            noOps,
          };
        } else failed += 1;

        // Checked after every row, so the gap between beats is bounded by one
        // row plus the interval rather than by a whole chunk.
        const now = this.tva.now().getTime();
        if (now - lastBeat >= HEARTBEAT_INTERVAL_MS) {
          if (!(await this.beat(batchId, claimed.applyAttemptId))) break outer;
          lastBeat = now;
        }
      }
    }

    const status = batchOutcome({
      totalRows: claimed.totalRows ?? rows.length + noOps,
      invalid: 0,
      conflict: 0,
      actionable: rows.length,
      applied,
      stale,
      failed,
    });

    const finished = await this.prisma.attendanceImportBatch.update({
      where: { id: batchId },
      data: {
        status: status as any,
        appliedAt: this.tva.now(),
        appliedRows: applied,
        failedRows: failed + stale,
        failureReason:
          status === 'FAILED'
            ? 'No row could be applied: every one failed unexpectedly.'
            : status === 'REVIEW_REQUIRED'
              ? 'Every row was refused because the attendance it referred to changed after approval. Re-preview and approve again.'
              : null,
        // The lease is released whichever way the run ended.
        applyAttemptId: null,
        applyHeartbeatAt: null,
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

  /** Whether a run is still alive. A missing heartbeat is a dead one. */
  private leaseIsFresh(batch: { applyHeartbeatAt?: Date | null }): boolean {
    if (!batch.applyHeartbeatAt) return false;
    return this.tva.now().getTime() - batch.applyHeartbeatAt.getTime() < APPLY_LEASE_MS;
  }

  /**
   * Proof of life, and only from the run that owns the batch.
   *
   * Scoped to the attempt id so a zombie worker that wakes up after being
   * replaced cannot refresh somebody else's lease and make a live run look
   * dead -- or a dead one look live.
   */
  private async beat(batchId: string, attemptId: string | null): Promise<boolean> {
    if (!attemptId) return false;
    const result = await this.prisma.attendanceImportBatch
      .updateMany({
        where: { id: batchId, applyAttemptId: attemptId },
        data: { applyHeartbeatAt: this.tva.now() },
      })
      .catch(() => ({ count: 0 }));

    // Zero rows updated means the attempt id moved on: somebody resumed this
    // batch while we were working, and we are the zombie now.
    return result.count > 0;
  }

  /**
   * Continues a batch whose run died.
   *
   * EXPLICIT, never automatic. No timer resumes a six-thousand-row import: a
   * lease expiring makes a resume permissible, and a person still has to ask
   * for it. Whoever asks claims a NEW attempt inside the batch row lock, so
   * two people racing to recover the same batch cannot both believe they own
   * it.
   *
   * Only rows that were never attempted continue. APPLIED rows are untouched
   * forever, and SKIPPED_STALE rows do not come back to life here -- they were
   * refused because the facts moved, and the answer to that is a fresh preview
   * and a fresh approval, not a retry against the same stale decision.
   */
  async resume(actor: any, batchId: string): Promise<ApplySummary> {
    this.assertHrAuthority(actor, 'resume');
    const applierId = this.actorId(actor);

    const claimed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "attendance_import_batches" WHERE id = ${batchId} FOR UPDATE`;

      const batch = await tx.attendanceImportBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Import batch not found');
      if (batch.status !== 'APPLYING') {
        throw new ForbiddenException(
          `Only a batch left mid-apply can be resumed; this one is ${batch.status.toLowerCase().replace(/_/g, ' ')}.`,
        );
      }
      if (this.leaseIsFresh(batch)) {
        throw new ConflictException(
          'That run is still alive. Wait for it to finish rather than starting a second one.',
        );
      }

      return tx.attendanceImportBatch.update({
        where: { id: batchId },
        data: {
          // A new attempt, so the previous worker's heartbeat can no longer
          // touch this batch even if it comes back.
          applyAttemptId: randomUUID(),
          applyHeartbeatAt: this.tva.now(),
          appliedById: applierId,
        },
      });
    });

    this.eventLogger
      .log({
        actorId: applierId,
        entityType: 'AttendanceImportBatch',
        entityId: batchId,
        action: 'ATTENDANCE_IMPORT_APPLY_RESUMED' as any,
        fromState: 'APPLYING',
        toState: 'APPLYING',
        metadata: {
          reference: claimed.reference,
          // appliedById on the batch is the LATEST executor, not the whole
          // list. Every attempt -- who and which id -- lives here in the event
          // stream, which is the only place that can answer "who ran this" when
          // a crash means more than one person did.
          resumedAttemptId: claimed.applyAttemptId,
          resumedBy: applierId,
        },
      })
      .catch(() => {});

    return this.processRows(claimed, applierId);
  }

  /**
   * Reclassifies a batch against CURRENT authoritative state.
   *
   * The only way out of REVIEW_REQUIRED, and a real review rather than a state
   * reset. Resetting rows to PENDING and asking for a fresh approval would put
   * a new signature on an old comparison -- HR would be approving what was true
   * when the batch was uploaded, which is exactly the thing that stopped being
   * true.
   *
   * THE PROPOSAL IS NOT RE-READ. proposedStatus, the punch times, the half day,
   * the leave type and the reason are the submitted claim, frozen at upload.
   * Only the CURRENT side is refreshed. A parser that behaves differently today
   * must never be able to change what somebody submitted last week.
   *
   * The comparison runs through the Phase 3 classifier -- the same one the
   * upload used -- so a re-previewed row is judged by identical rules rather
   * than by a second implementation that agrees today.
   */
  async rePreview(actor: any, batchId: string) {
    this.assertHrAuthority(actor, 're-preview');

    const batch = await this.prisma.attendanceImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status !== 'REVIEW_REQUIRED' && batch.status !== 'PARTIALLY_APPLIED') {
      throw new ForbiddenException(
        'Only a batch that stopped because the facts changed needs re-previewing.',
      );
    }
    // APPLIED rows are history and are never reconsidered: not reclassified,
    // not re-snapshotted, not unlinked from the correction they produced.
    const unresolved = await this.prisma.attendanceImportRow.findMany({
      where: { batchId, applyState: { in: ['SKIPPED_STALE', 'FAILED', 'PENDING'] } },
      orderBy: [{ businessDate: 'asc' }, { rowNumber: 'asc' }],
    });

    const actionable = unresolved.filter((r) => r.classification !== 'MATCH');
    const refreshed = await this.reclassify(actionable);

    // Applied in bounded chunks; each row's refreshed comparison is one update.
    for (const row of refreshed) {
      await this.prisma.attendanceImportRow.update({
        where: { id: row.id },
        data: {
          classification: row.classification as any,
          messages: row.messages,
          warnings: row.warnings,
          currentStatus: row.currentStatus as any,
          currentPunchIn: row.currentPunchIn,
          currentPunchOut: row.currentPunchOut,
          currentPunchInEvidenceId: row.currentPunchInEvidenceId,
          currentPunchOutEvidenceId: row.currentPunchOutEvidenceId,
          currentFingerprint: row.currentFingerprint,
          // Back to never-attempted, now that the comparison is current.
          applyState: 'PENDING',
          failureReason: null,
        },
      });
    }

    const counts = await this.recount(batchId);

    const updated = await this.prisma.attendanceImportBatch.update({
      where: { id: batchId },
      data: {
        status: counts.invalid > 0 || counts.conflict > 0 ? 'HAS_ERRORS' : 'READY_FOR_REVIEW',
        // CLEARED. An approval describes a comparison, and the comparison has
        // changed; the original stays visible in the event stream, but it
        // cannot authorise what HR has not seen.
        approvedById: null,
        approvedAt: null,
        applyAttemptId: null,
        applyHeartbeatAt: null,
        failureReason: null,
        newRows: counts.newRows,
        matchRows: counts.match,
        changeRows: counts.change,
        conflictRows: counts.conflict,
        invalidRows: counts.invalid,
      },
    });

    this.eventLogger
      .log({
        actorId: this.actorId(actor),
        entityType: 'AttendanceImportBatch',
        entityId: batchId,
        action: 'ATTENDANCE_IMPORT_REPREVIEW' as any,
        fromState: batch.status,
        toState: updated.status,
        metadata: {
          reference: batch.reference,
          reclassified: refreshed.length,
          previousApprovedById: batch.approvedById,
          ...counts,
        },
      })
      .catch(() => {});

    return updated;
  }

  /**
   * The Phase 3 classifier, run against today rather than against upload day.
   *
   * The frozen proposal is handed back to the same classifyRow() the upload
   * used; only the context around it is rebuilt from current truth.
   */
  private async reclassify(rows: any[]) {
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const dates = rows.map((r) => this.tva.companyBusinessDate(r.businessDate)).sort();
    const from = dates[0];
    const to = dates[dates.length - 1];

    const [records, monthCloses, openCorrections] = await Promise.all([
      this.prisma.dailyAttendance.findMany({
        where: {
          userId: { in: userIds },
          date: {
            gte: this.tva.companyDateOnly(new Date(`${from}T00:00:00.000Z`)),
            lte: this.tva.companyDateOnly(new Date(`${to}T00:00:00.000Z`)),
          },
        },
        select: {
          userId: true, date: true, status: true, punchInAt: true, punchOutAt: true,
          evaluationState: true, locked: true, punchInEvidenceId: true,
          punchOutEvidenceId: true, sourceFingerprint: true,
        },
      }),
      this.prisma.attendanceMonthClose.findMany({
        where: { month: { in: [...new Set(dates.map((d) => d.slice(0, 7)))] } },
        select: { month: true, status: true },
      }),
      this.prisma.attendanceRegularization.findMany({
        where: {
          userId: { in: userIds },
          status: { in: [...OPEN_CORRECTION_STATUSES] },
          date: {
            gte: this.tva.companyDateOnly(new Date(`${from}T00:00:00.000Z`)),
            lte: this.tva.companyDateOnly(new Date(`${to}T00:00:00.000Z`)),
          },
        },
        select: { userId: true, date: true },
      }),
    ]);

    const key = (userId: string, businessDate: string) => `${userId}|${businessDate}`;
    const currentByKey = new Map(
      records.map((r) => [
        key(r.userId, this.tva.companyBusinessDate(r.date)),
        {
          status: r.status,
          punchInAt: r.punchInAt,
          punchOutAt: r.punchOutAt,
          evaluationState: r.evaluationState,
          locked: r.locked,
          punchInEvidenceId: r.punchInEvidenceId,
          punchOutEvidenceId: r.punchOutEvidenceId,
          sourceFingerprint: r.sourceFingerprint,
        },
      ]),
    );

    // Leave is re-asked for the rows that claim it, exactly as at upload.
    const approvedLeaveByKey = new Map<string, { kind: string }>();
    const leaveRows = rows.filter(
      (r) => r.proposedStatus === 'LEAVE' || r.proposedStatus === 'LWP',
    );
    for (const row of leaveRows) {
      const businessDate = this.tva.companyBusinessDate(row.businessDate);
      const fact = await this.leaveFacts
        .resolveForDate(row.userId, businessDate)
        .catch(() => ({ kind: 'NONE' as const }));
      approvedLeaveByKey.set(key(row.userId, businessDate), fact as any);
    }

    const context = {
      currentByKey,
      monthStatusByMonth: new Map(monthCloses.map((m) => [m.month, m.status])),
      openCorrections: new Set(
        openCorrections.map((c) => key(c.userId, this.tva.companyBusinessDate(c.date))),
      ),
      approvedLeaveByKey,
      // Within-file duplicates were settled at upload and made those rows
      // INVALID; nothing unresolved can be one.
      duplicateRows: new Map(),
    };

    return rows.map((row) => {
      const businessDate = this.tva.companyBusinessDate(row.businessDate);
      const classified = classifyRow(
        {
          rowNumber: row.rowNumber,
          raw: {
            rowNumber: row.rowNumber,
            rawEmployeeId: row.rawEmployeeId,
            rawEmployeeName: row.rawName ?? '',
          } as any,
          problems: [],
          warnings: [],
          // THE FROZEN CLAIM, handed back unchanged.
          proposal: {
            userId: row.userId,
            employeeId: row.rawEmployeeId,
            employeeName: row.rawName ?? '',
            businessDate,
            proposedStatus: row.proposedStatus,
            proposedPunchIn: row.proposedPunchIn,
            proposedPunchOut: row.proposedPunchOut,
            proposedHalfDay: row.proposedHalfDay,
            proposedLeaveType: row.proposedLeaveType,
            normalizedReason: row.normalizedReason ?? '',
          },
        } as any,
        context as any,
      );

      const current = currentByKey.get(key(row.userId, businessDate));
      return {
        id: row.id,
        classification: classified.classification,
        messages: [
          ...classified.errors.map((e) => e.code),
          ...classified.conflicts.map((c) => c.code),
        ],
        warnings: classified.warnings.map((w) => w.code),
        currentStatus: current?.status ?? null,
        currentPunchIn: current?.punchInAt ?? null,
        currentPunchOut: current?.punchOutAt ?? null,
        currentPunchInEvidenceId: current?.punchInEvidenceId ?? null,
        currentPunchOutEvidenceId: current?.punchOutEvidenceId ?? null,
        currentFingerprint: current?.sourceFingerprint ?? null,
      };
    });
  }

  /** Counts read back from the rows, never carried forward from before. */
  private async recount(batchId: string) {
    const [newRows, match, change, conflict, invalid] = await Promise.all([
      this.prisma.attendanceImportRow.count({ where: { batchId, classification: 'NEW' } }),
      this.prisma.attendanceImportRow.count({ where: { batchId, classification: 'MATCH' } }),
      this.prisma.attendanceImportRow.count({ where: { batchId, classification: 'CHANGE' } }),
      this.prisma.attendanceImportRow.count({ where: { batchId, classification: 'CONFLICT' } }),
      this.prisma.attendanceImportRow.count({ where: { batchId, classification: 'INVALID' } }),
    ]);
    return { newRows, match, change, conflict, invalid };
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
  ): Promise<'APPLIED' | 'SKIPPED_STALE' | 'FAILED' | 'LOST_OWNERSHIP'> {
    const businessDate = this.tva.companyBusinessDate(row.businessDate);

    try {
      await this.prisma.$transaction(async (tx) => {
        // OWNERSHIP, INSIDE THE TRANSACTION THAT WOULD WRITE.
        //
        // Protecting the heartbeat is not enough. A worker that stalls past its
        // lease, is replaced, and then wakes must not go on revising
        // attendance -- so the right to write is re-proved here, in the same
        // transaction as the write, rather than assumed from a claim made
        // minutes ago.
        const owner = await tx.attendanceImportBatch.findUnique({
          where: { id: batch.id },
          select: { applyAttemptId: true },
        });
        if (!owner || owner.applyAttemptId !== batch.applyAttemptId) {
          throw new LostOwnership();
        }

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
      // Not our batch any more. Write nothing at all, not even a row status:
      // these rows belong to whoever holds the current attempt.
      if (error instanceof LostOwnership) return 'LOST_OWNERSHIP';

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
export class LostOwnership extends Error {
  constructor() {
    super('This batch was taken over by another apply attempt.');
    this.name = 'LostOwnership';
  }
}

export class StaleRow extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleRow';
  }
}
