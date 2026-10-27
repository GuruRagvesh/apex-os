import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { EventLoggerService, OperationalAction } from '../../../../common/services/event-logger.service';
import { SettingsService } from '../../settings/settings.service';
import { DailyAttendanceEvaluatorService } from '../evaluation/daily-attendance-evaluator.service';
import { businessMonthOf, describeSettlement } from '../evaluation/attendance-settlement';
import { lockAttendanceMonth } from '../evaluation/attendance-month-lock';
import { ATTENDANCE_V2_DEFAULTS, ATTENDANCE_V2_SETTING_KEY } from '../punch/punch-evidence.types';
import { NotificationEventService } from '../../../operations/notifications/notification-event.service';
import { SCREENSHOT_METADATA } from './correction-screenshot';
import { CorrectionAuthorityService, type CorrectionEligibility } from './correction-authority.service';

/**
 * Attendance-correction decisions (Phase 3).
 *
 * One workflow: an unresolved request receives ONE final decision from any
 * eligible reviewer (see CorrectionAuthorityService). HR is an alternative
 * final approver, not a second stage. The first committed decision wins under
 * a row lock; every decision records actor, role snapshot, eligibility,
 * decision, time and reason, and is immutable afterwards (database trigger).
 *
 * Applying an approval keeps every existing protection: the reviewed
 * fingerprint, the month lock, the settled-day checks and the recovered
 * historical-day refusal. The outcomes:
 *
 *   stale        day changed since the reviewer looked -> no decision recorded;
 *                request becomes STALE_REVIEW_REQUIRED; attempt audited
 *   locked       finalized / locked / corrected / historical / closed month ->
 *                approval recorded, applicationStatus REVIEW_REQUIRED, day untouched
 *   matches      day already says what was asked -> NOT_REQUIRED
 *   otherwise    approval recorded and applied (APPLIED)
 *
 * Punch evidence, work sessions and the employee's request text are never
 * modified.
 */

export const UNRESOLVED_STATUSES = ['PENDING', 'STALE_REVIEW_REQUIRED', 'MANAGER_APPROVED'] as const;
const FINAL_STATUSES = ['APPROVED', 'REJECTED', 'HR_APPROVED'];
const MIN_DECISION_REASON = 3;

export type CorrectionScope = 'team' | 'company';

export interface DecisionInput {
  decision?: string;
  reason?: string;
  /** The official-day fingerprint the reviewer was shown. */
  reviewedFingerprint?: string | null;
  /** Required when an HR/Admin creator decides a manual recovery they entered. */
  confirmCreatorDecision?: boolean;
}

export interface ApplyHeldInput {
  /** Current fingerprint displayed during the refreshed confirmation. */
  reviewedFingerprint?: string | null;
}

/**
 * A held approval may be applied directly only while the official day still
 * matches the fingerprint that was approved. If it changed, the caller must
 * have refreshed and explicitly send the new fingerprint.
 */
export function needsRefreshedApply(
  approvedFingerprint: string | null | undefined,
  currentFingerprint: string | null,
  reviewedFingerprint: string | null | undefined,
): boolean {
  return currentFingerprint !== (approvedFingerprint ?? null) && reviewedFingerprint !== currentFingerprint;
}

/** A structured refusal the frontend can act on. */
function conflict(code: string, message: string, details: Record<string, unknown> = {}) {
  return new ConflictException({ code, message, ...details });
}

@Injectable()
export class CorrectionDecisionService {
  private readonly logger = new Logger(CorrectionDecisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly eventLogger: EventLoggerService,
    private readonly settings: SettingsService,
    private readonly evaluator: DailyAttendanceEvaluatorService,
    private readonly authority: CorrectionAuthorityService,
    @Optional() private readonly notifications?: NotificationEventService,
  ) {}

  /** Expand-and-enable: the single-decision route is OFF until enabled. */
  async enabled(): Promise<boolean> {
    const cfg = await this.settings.get(ATTENDANCE_V2_SETTING_KEY);
    return (cfg?.correctionDecisionEnabled ?? ATTENDANCE_V2_DEFAULTS.correctionDecisionEnabled) === true;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Queues
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Unresolved requests for one scope, filtered IN POSTGRESQL before ordering
   * and paging. Team: the actor's valid TL/Manager hierarchy. Company: HR,
   * Admin and Super Admin only. No global page is ever fetched and filtered in
   * memory, so no request can fall off the end of somebody else's page.
   */
  async queue(actorId: string, scope: CorrectionScope, pageInput?: number, limitInput?: number) {
    const actor = await this.authority.loadActor(actorId);
    const page = Math.max(1, Number(pageInput) || 1);
    const limit = Math.min(200, Math.max(1, Number(limitInput) || 50));

    let where: Prisma.AttendanceRegularizationWhereInput;
    if (scope === 'company') {
      if (!this.authority.canViewCompany(actor)) {
        throw new ForbiddenException({ code: 'CORRECTION_SCOPE_FORBIDDEN', message: 'The company queue is for HR and administrators.' });
      }
      where = { status: { in: [...UNRESOLVED_STATUSES] }, userId: { not: actorId } };
    } else {
      const ids = await this.authority.teamSubjectIds(actor);
      where = { status: { in: [...UNRESOLVED_STATUSES] }, userId: { in: ids } };
    }

    const [items, total, counts] = await Promise.all([
      this.prisma.attendanceRegularization.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true, employeeId: true } },
          screenshots: { select: SCREENSHOT_METADATA },
        },
      }),
      this.prisma.attendanceRegularization.count({ where }),
      this.counts(actorId, actor),
    ]);

    return {
      scope,
      page,
      limit,
      total,
      counts,
      items: await Promise.all(items.map(async (row) => ({
        ...row,
        requestType: row.policyCorrectionType ?? row.requestType,
        eligibleVia: (await this.authority.eligibility(actor, row.userId))?.via ?? null,
        current: await this.currentDay(row.userId, row.date),
      }))),
    };
  }

  /** Badge counts for both tabs. Company is null for people without that scope. */
  async counts(actorId: string, loaded?: any) {
    const actor = loaded ?? (await this.authority.loadActor(actorId));
    const ids = await this.authority.teamSubjectIds(actor);
    const [team, company] = await Promise.all([
      ids.length
        ? this.prisma.attendanceRegularization.count({ where: { status: { in: [...UNRESOLVED_STATUSES] }, userId: { in: ids } } })
        : Promise.resolve(0),
      this.authority.canViewCompany(actor)
        ? this.prisma.attendanceRegularization.count({ where: { status: { in: [...UNRESOLVED_STATUSES] }, userId: { not: actorId } } })
        : Promise.resolve(null),
    ]);
    return { team, company, canViewCompany: this.authority.canViewCompany(actor) };
  }

  /** Approved corrections that still need an HR/Admin application step. */
  async held(actorId: string) {
    const actor = await this.authority.loadActor(actorId);
    if (!this.authority.canViewCompany(actor)) {
      throw new ForbiddenException({ code: 'CORRECTION_SCOPE_FORBIDDEN', message: 'Held corrections are for HR and administrators.' });
    }
    const rows = await this.prisma.attendanceRegularization.findMany({
      where: { status: 'APPROVED' as any, applicationStatus: 'REVIEW_REQUIRED' as any },
      orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
      take: 200,
      include: { user: { select: { id: true, name: true, email: true, employeeId: true } }, screenshots: { select: SCREENSHOT_METADATA } },
    });
    return { items: await Promise.all(rows.map(async (row) => ({ ...row, requestType: row.policyCorrectionType ?? row.requestType, current: await this.currentDay(row.userId, row.date) }))) };
  }

  /** The official values a reviewer is deciding against, with its fingerprint. */
  async currentDay(userId: string, date: Date) {
    const day = await this.prisma.dailyAttendance.findUnique({
      where: { userId_date: { userId, date } },
      select: { status: true, punchInAt: true, punchOutAt: true, evaluationState: true, locked: true, revision: true, sourceFingerprint: true },
    });
    return day
      ? { status: day.status, punchInAt: day.punchInAt, punchOutAt: day.punchOutAt, evaluationState: day.evaluationState, locked: day.locked, revision: day.revision, fingerprint: day.sourceFingerprint }
      : null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Decision
  // ───────────────────────────────────────────────────────────────────────

  private blockingReason(row: any, official: any, monthClose: any): string | null {
    if (official?.calculationReason === 'HISTORICAL_RECOVERY_IMPORT') return 'HISTORICAL_RECOVERY_DAY';
    const settled = describeSettlement({ day: official, monthClose });
    if (settled.includes('SENT_MONTH')) return 'MONTH_SENT';
    if (settled.includes('FINALIZED_MONTH')) return 'MONTH_FINALIZED';
    if (settled.includes('LOCKED_DAY')) return 'DAY_LOCKED';
    if (settled.includes('FINALIZED_DAY')) return 'DAY_FINALIZED';
    if ((official?.revision ?? 0) > 0 && official?.lastRegularizationId && official.lastRegularizationId !== row.id) {
      return 'DAY_MANUALLY_CORRECTED';
    }
    return null;
  }

  private alreadyMatches(row: any, official: any): boolean {
    if (!official) return false;
    const same = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : a.getTime() === b.getTime());
    const inOk = row.requestedPunchIn ? same(row.requestedPunchIn, official.punchInAt) : true;
    const outOk = row.requestedPunchOut ? same(row.requestedPunchOut, official.punchOutAt) : true;
    const statusOk = row.proposedStatus ? row.proposedStatus === official.status : true;
    const asksSomething = !!(row.requestedPunchIn || row.requestedPunchOut || row.proposedStatus);
    return asksSomething && inOk && outOk && statusOk;
  }

  async decide(actorId: string, id: string, input: DecisionInput) {
    return this.decideInternal(actorId, id, input, false);
  }

  /**
   * Compatibility endpoint used only while the expand-and-enable flag is off.
   * It deliberately shares the v1 decision writer, so a new rejection can
   * never fall back to the legacy approver columns after the migration.
   */
  async decideCompatibility(actorId: string, id: string, input: DecisionInput) {
    return this.decideInternal(actorId, id, input, true);
  }

  private async decideInternal(actorId: string, id: string, input: DecisionInput, compatibility: boolean) {
    if (!compatibility && !(await this.enabled())) {
      throw new ServiceUnavailableException({ code: 'CORRECTION_WORKFLOW_DISABLED', message: 'The single-decision correction workflow is not enabled yet.' });
    }
    const decision = input?.decision;
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      throw new BadRequestException('decision must be APPROVE or REJECT');
    }
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < MIN_DECISION_REASON) {
      throw new BadRequestException({ code: 'CORRECTION_REASON_REQUIRED', message: 'Give a reason for this decision.' });
    }

    type Outcome =
      | { kind: 'DECIDED'; row: any; eligibility: CorrectionEligibility; revision: any | null; businessDate: string }
      | { kind: 'STALE'; row: any; current: any; businessDate: string; eligibility: CorrectionEligibility };

    const outcome: Outcome = await this.prisma.$transaction(async (tx): Promise<Outcome> => {
      await tx.$queryRaw`SELECT id FROM "attendance_regularizations" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.attendanceRegularization.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Correction request not found');

      if (FINAL_STATUSES.includes(row.status)) {
        const by = row.decidedById ?? row.hrApproverId ?? row.managerApproverId;
        const name = by ? (await tx.user.findUnique({ where: { id: by }, select: { name: true } }))?.name ?? null : null;
        throw conflict('CORRECTION_ALREADY_DECIDED', name ? `Already decided by ${name}.` : 'This request has already been decided.', {
          status: row.status,
          decidedByName: name,
          decidedByRole: row.decidedByRole ?? null,
          decidedAt: row.decidedAt ?? row.hrDecisionAt ?? row.managerDecisionAt ?? null,
        });
      }

      // Authorization is re-checked HERE, under the lock, against today's
      // hierarchy and roles -- never from a list fetched earlier.
      if (row.userId === actorId) {
        throw new ForbiddenException({ code: 'CORRECTION_SELF_DECISION', message: 'You cannot decide your own attendance correction.' });
      }
      const actor = await this.authority.loadActor(actorId);
      const eligibility = await this.authority.eligibility(actor, row.userId);
      if (!eligibility) {
        throw new ForbiddenException({ code: 'CORRECTION_NOT_ELIGIBLE', message: "Only this employee's Team Lead, reporting Manager, HR or an administrator can decide this correction." });
      }
      if (row.createdById && row.createdById === actorId) {
        if (eligibility.scope !== 'company') {
          throw new ForbiddenException({ code: 'CORRECTION_CREATOR_DECISION', message: 'You entered this recovery, so another reviewer must decide it.' });
        }
        if (input.confirmCreatorDecision !== true) {
          throw conflict('CORRECTION_CREATOR_CONFIRMATION_REQUIRED', 'You entered this recovery. Confirm separately that you are also deciding it.');
        }
      }

      const businessDate = this.tva.companyBusinessDate(row.date);
      const now = this.tva.now();
      const decided = (data: Record<string, unknown>) =>
        tx.attendanceRegularization.update({
          where: { id },
          data: {
            decisionProtocolVersion: 1,
            decision: decision as any,
            decidedById: actorId,
            decidedByRole: eligibility.role,
            decidedVia: eligibility.via,
            decidedAt: now,
            decisionReason: reason.slice(0, 2000),
            ...data,
          } as any,
        });

      if (decision === 'REJECT') {
        const updated = await decided({
          status: 'REJECTED',
          applicationStatus: 'NOT_REQUIRED',
          decisionFingerprint: input.reviewedFingerprint ?? row.basedOnFingerprint ?? null,
        });
        return { kind: 'DECIDED' as const, row: updated, eligibility, revision: null, businessDate };
      }

      // Review-only requests record the decision and change no attendance.
      if (row.requestType === 'OTHER' || row.policyCorrectionType === 'INCORRECT_ATTENDANCE_STATUS') {
        const updated = await decided({ status: 'APPROVED', applicationStatus: 'NOT_REQUIRED', applicationFailureReason: 'REVIEW_ONLY_REQUEST' });
        return { kind: 'DECIDED' as const, row: updated, eligibility, revision: null, businessDate };
      }

      // The official day, locked, then the month.
      await tx.$queryRaw`SELECT id FROM "daily_attendance" WHERE "userId" = ${row.userId} AND "date" = ${row.date}::date FOR UPDATE`;
      const month = businessMonthOf(businessDate);
      await lockAttendanceMonth(tx, month);
      const [official, monthClose] = await Promise.all([
        tx.dailyAttendance.findUnique({ where: { userId_date: { userId: row.userId, date: row.date } } }),
        tx.attendanceMonthClose.findUnique({ where: { month }, select: { status: true } }),
      ]);

      // A. Stale: the reviewer decided against facts that have since changed.
      const reviewed = input.reviewedFingerprint ?? (row.status === 'STALE_REVIEW_REQUIRED' ? null : row.basedOnFingerprint);
      const currentFingerprint = official?.sourceFingerprint ?? null;
      const stale =
        row.status === 'STALE_REVIEW_REQUIRED'
          ? reviewed !== currentFingerprint
          : !!reviewed && !!currentFingerprint && reviewed !== currentFingerprint;
      if (stale) {
        const updated = await tx.attendanceRegularization.update({
          where: { id },
          data: { status: 'STALE_REVIEW_REQUIRED', staleDetectedAt: now, staleFingerprint: currentFingerprint },
        });
        return { kind: 'STALE' as const, row: updated, current: official, businessDate, eligibility };
      }

      // B. Locked or closed: the approval stands; the day is not touched.
      const blocked = this.blockingReason(row, official, monthClose);
      if (blocked) {
        const updated = await decided({
          status: 'APPROVED',
          applicationStatus: 'REVIEW_REQUIRED',
          applicationFailureReason: blocked,
          decisionFingerprint: currentFingerprint,
        });
        return { kind: 'DECIDED' as const, row: updated, eligibility, revision: null, businessDate };
      }

      // C. Already matches: nothing to change.
      if (this.alreadyMatches(row, official)) {
        const updated = await decided({ status: 'APPROVED', applicationStatus: 'NOT_REQUIRED', applicationFailureReason: 'ATTENDANCE_ALREADY_MATCHES', decisionFingerprint: currentFingerprint });
        return { kind: 'DECIDED' as const, row: updated, eligibility, revision: null, businessDate };
      }

      // Applied: decision and revision commit together.
      const updated = await decided({ status: 'APPROVED', applicationStatus: 'APPLIED', appliedAt: now, decisionFingerprint: currentFingerprint });
      const revision = await this.evaluator.reviseForApprovedCorrection(tx, row.userId, businessDate, id);
      return { kind: 'DECIDED' as const, row: updated, eligibility, revision, businessDate };
    }).catch((error: any) => {
      if (error?.code === 'P2034') throw conflict('CORRECTION_ALREADY_DECIDED', 'Another decision was saved first. Refresh to see it.');
      throw error;
    });

    if (outcome.kind === 'STALE') {
      this.eventLogger.log({
        actorId,
        entityType: 'AttendanceRegularization',
        entityId: id,
        action: OperationalAction.REGULARIZATION_DECISION_STALE,
        fromState: 'PENDING',
        toState: 'STALE_REVIEW_REQUIRED',
        metadata: { attemptedDecision: decision, reason: reason.slice(0, 200), via: outcome.eligibility.via, staleFingerprint: outcome.row.staleFingerprint },
      }).catch(() => {});
      throw conflict('CORRECTION_STALE', 'The attendance for this day changed after the request was raised. Review the current values and decide again.', {
        previous: { punchInAt: outcome.row.originalPunchIn, punchOutAt: outcome.row.originalPunchOut },
        requested: { punchInAt: outcome.row.requestedPunchIn, punchOutAt: outcome.row.requestedPunchOut, status: outcome.row.proposedStatus },
        current: outcome.current
          ? { status: outcome.current.status, punchInAt: outcome.current.punchInAt, punchOutAt: outcome.current.punchOutAt, fingerprint: outcome.current.sourceFingerprint }
          : null,
      });
    }

    const { row, eligibility, revision, businessDate } = outcome;
    this.eventLogger.log({
      actorId,
      entityType: 'AttendanceRegularization',
      entityId: id,
      action: OperationalAction.REGULARIZATION_DECIDED,
      toState: row.status,
      metadata: { decision, via: eligibility.via, role: eligibility.role, applicationStatus: row.applicationStatus, applicationFailureReason: row.applicationFailureReason ?? null, reason: reason.slice(0, 200) },
    }).catch(() => {});
    if (revision) {
      this.eventLogger.log({
        actorId,
        entityType: 'DailyAttendance',
        entityId: revision.after.id,
        action: OperationalAction.ATTENDANCE_OFFICIAL_REVISED,
        fromState: revision.before?.status ?? 'NONE',
        toState: revision.after.status,
        metadata: { businessDate, regularizationId: id, revision: revision.after.revision },
      }).catch(() => {});
    }
    await this.notifyDecided(row, actorId).catch(() => undefined);
    return row;
  }

  /**
   * Applies an approval held at REVIEW_REQUIRED once the blocker is cleared
   * (month or day reopened through the payroll workflow). HR/Admin only; the
   * same gates run again and nothing is forced.
   */
  async applyHeld(actorId: string, id: string, input: ApplyHeldInput = {}) {
    const actor = await this.authority.loadActor(actorId);
    if (!this.authority.canViewCompany(actor)) throw new ForbiddenException('Only HR and administrators can apply a held correction');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "attendance_regularizations" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.attendanceRegularization.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Correction request not found');
      if (row.status !== 'APPROVED' || row.applicationStatus !== 'REVIEW_REQUIRED') {
        throw conflict('CORRECTION_NOT_HELD', 'Only an approved correction awaiting application can be applied.');
      }
      const businessDate = this.tva.companyBusinessDate(row.date);
      await tx.$queryRaw`SELECT id FROM "daily_attendance" WHERE "userId" = ${row.userId} AND "date" = ${row.date}::date FOR UPDATE`;
      const month = businessMonthOf(businessDate);
      await lockAttendanceMonth(tx, month);
      const [official, monthClose] = await Promise.all([
        tx.dailyAttendance.findUnique({ where: { userId_date: { userId: row.userId, date: row.date } } }),
        tx.attendanceMonthClose.findUnique({ where: { month }, select: { status: true } }),
      ]);
      const currentFingerprint = official?.sourceFingerprint ?? null;
      if (needsRefreshedApply(row.decisionFingerprint, currentFingerprint, input.reviewedFingerprint)) {
        // Keep the committed approval and its application state untouched.
        // The caller must refresh, inspect the current values and explicitly
        // confirm that exact fingerprint in a later request.
        throw conflict(
          'CORRECTION_APPLICATION_STALE',
          'Attendance changed after this correction was approved. Review the current values and confirm again.',
          {
            approvedFingerprint: row.decisionFingerprint,
            currentFingerprint,
            current: official
              ? { status: official.status, punchInAt: official.punchInAt, punchOutAt: official.punchOutAt, fingerprint: currentFingerprint }
              : null,
          },
        );
      }
      const blocked = this.blockingReason(row, official, monthClose);
      if (blocked) throw conflict('CORRECTION_STILL_BLOCKED', 'This day is still locked or closed.', { applicationFailureReason: blocked });
      const updated = await tx.attendanceRegularization.update({
        where: { id },
        data: {
          applicationStatus: 'APPLIED',
          applicationFailureReason: null,
          appliedAt: this.tva.now(),
        },
      });
      await this.evaluator.reviseForApprovedCorrection(tx, row.userId, businessDate, id);
      return updated;
    });
  }

  /**
   * Gated migration helper for a historical MANAGER_APPROVED row. The actor
   * and role are facts recovered by the reconciliation script, not today's
   * authorization. Every ordinary HTTP caller must use decide().
   */
  async reconcileLegacyManagerApproval(id: string, actorId: string, decidedByRole: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "attendance_regularizations" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.attendanceRegularization.findUnique({ where: { id } });
      if (!row) return { kind: 'SKIPPED', reason: 'NOT_FOUND' } as const;
      if (row.status !== 'MANAGER_APPROVED' || !row.managerApproverId || row.managerApproverId !== actorId) {
        return { kind: 'SKIPPED', reason: 'NOT_LEGACY_MANAGER_APPROVED' } as const;
      }
      const now = row.managerDecisionAt ?? this.tva.now();
      const businessDate = this.tva.companyBusinessDate(row.date);
      await tx.$queryRaw`SELECT id FROM "daily_attendance" WHERE "userId" = ${row.userId} AND "date" = ${row.date}::date FOR UPDATE`;
      const month = businessMonthOf(businessDate);
      await lockAttendanceMonth(tx, month);
      const [official, monthClose] = await Promise.all([
        tx.dailyAttendance.findUnique({ where: { userId_date: { userId: row.userId, date: row.date } } }),
        tx.attendanceMonthClose.findUnique({ where: { month }, select: { status: true } }),
      ]);
      const currentFingerprint = official?.sourceFingerprint ?? null;
      if (row.basedOnFingerprint && currentFingerprint && row.basedOnFingerprint !== currentFingerprint) {
        await tx.attendanceRegularization.update({ where: { id }, data: { status: 'STALE_REVIEW_REQUIRED', staleDetectedAt: this.tva.now(), staleFingerprint: currentFingerprint } });
        return { kind: 'STALE' } as const;
      }
      const common = {
        status: 'APPROVED' as any,
        decisionProtocolVersion: 1,
        decision: 'APPROVE' as any,
        decidedById: actorId,
        decidedByRole,
        decidedVia: 'LEGACY_STAGE_APPROVAL',
        decidedAt: now,
        decisionReason: 'Legacy manager approval reconciled',
        decisionFingerprint: currentFingerprint,
      };
      if (row.requestType === 'OTHER' || row.policyCorrectionType === 'INCORRECT_ATTENDANCE_STATUS') {
        await tx.attendanceRegularization.update({ where: { id }, data: { ...common, applicationStatus: 'NOT_REQUIRED', applicationFailureReason: 'REVIEW_ONLY_REQUEST' } });
        return { kind: 'NOT_REQUIRED' } as const;
      }
      const blocked = this.blockingReason(row, official, monthClose);
      if (blocked) {
        await tx.attendanceRegularization.update({ where: { id }, data: { ...common, applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: blocked } });
        return { kind: 'REVIEW_REQUIRED', reason: blocked } as const;
      }
      if (this.alreadyMatches(row, official)) {
        await tx.attendanceRegularization.update({ where: { id }, data: { ...common, applicationStatus: 'NOT_REQUIRED', applicationFailureReason: 'ATTENDANCE_ALREADY_MATCHES' } });
        return { kind: 'NOT_REQUIRED' } as const;
      }
      await tx.attendanceRegularization.update({ where: { id }, data: { ...common, applicationStatus: 'APPLIED', appliedAt: this.tva.now() } });
      await this.evaluator.reviseForApprovedCorrection(tx, row.userId, businessDate, id);
      return { kind: 'APPLIED' } as const;
    });
    return outcome;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Notifications
  // ───────────────────────────────────────────────────────────────────────

  /** New request: hierarchy reviewers and the company reviewers. */
  async notifyCreated(row: { id: string; userId: string; date: Date }) {
    if (!this.notifications) return;
    const subject = await this.prisma.user.findUnique({ where: { id: row.userId }, select: { name: true } });
    const { team, company } = await this.authority.eligibleReviewerIds(row.userId);
    const recipients = new Set([...team, ...company]);
    for (const userId of recipients) {
      await this.notifications.sendNotification(userId, 'attendanceCorrection', {
        title: `Attendance correction: ${subject?.name ?? 'An employee'}`,
        message: `${subject?.name ?? 'An employee'} asked to correct ${this.tva.companyBusinessDate(row.date)}.`,
        type: NotificationType.INFO,
        link: team.includes(userId) ? '/attendance/reviews?scope=team' : '/attendance/reviews?scope=company',
        entityId: row.id,
        entityType: 'ATTENDANCE_CORRECTION',
        dedupeKey: `regularization:${row.id}:created:${userId}`,
      } as any).catch(() => undefined);
    }
  }

  /** First decision: the employee, and every other reviewer that it is resolved. */
  private async notifyDecided(row: any, actorId: string) {
    if (!this.notifications) return;
    const [subject, actor] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: row.userId }, select: { name: true } }),
      this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }),
    ]);
    const date = this.tva.companyBusinessDate(row.date);
    const verb = row.status === 'APPROVED' ? 'approved' : 'rejected';
    const applied =
      row.applicationStatus === 'REVIEW_REQUIRED'
        ? ' The attendance day is locked or closed, so HR will apply it after reopening.'
        : row.applicationFailureReason === 'ATTENDANCE_ALREADY_MATCHES'
          ? ' No attendance change was needed.'
          : '';
    await this.notifications.sendNotification(row.userId, 'attendanceCorrectionDecided', {
      title: `Attendance correction ${verb}`,
      message: `Your correction for ${date} was ${verb} by ${actor?.name ?? 'a reviewer'} (${row.decidedByRole}).${applied}`,
      type: row.status === 'APPROVED' ? NotificationType.SUCCESS : NotificationType.WARNING,
      link: '/attendance',
      entityId: row.id,
      entityType: 'ATTENDANCE_CORRECTION',
      dedupeKey: `regularization:${row.id}:decided:${row.userId}`,
    } as any).catch(() => undefined);

    const { team, company } = await this.authority.eligibleReviewerIds(row.userId);
    for (const userId of new Set([...team, ...company])) {
      if (userId === actorId) continue;
      await this.notifications.sendNotification(userId, 'attendanceCorrection', {
        title: `Already resolved: ${subject?.name ?? 'attendance correction'}`,
        message: `${subject?.name ?? 'An employee'}'s correction for ${date} was ${verb} by ${actor?.name ?? 'another reviewer'} (${row.decidedByRole}). No action is needed.`,
        type: NotificationType.INFO,
        entityId: row.id,
        entityType: 'ATTENDANCE_CORRECTION',
        dedupeKey: `regularization:${row.id}:decided:${userId}`,
      } as any).catch(() => undefined);
    }
  }
}
