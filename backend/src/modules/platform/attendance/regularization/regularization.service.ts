import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { EventLoggerService, OperationalAction } from '../../../../common/services/event-logger.service';
import { HierarchyApprovalService } from '../../../../common/services/hierarchy-approval.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { SettingsService } from '../../settings/settings.service';
import { DailyAttendanceEvaluatorService } from '../evaluation/daily-attendance-evaluator.service';
import {
  ATTENDANCE_V2_DEFAULTS,
  ATTENDANCE_V2_SETTING_KEY,
} from '../punch/punch-evidence.types';

/**
 * Attendance regularization (AR-1).
 *
 * Activates the dormant AttendanceRegularization model rather than adding a
 * parallel correction table. Its existing RegularizationStatus already encodes
 * the maker-checker chain, so nothing new was invented for it:
 *
 *   PENDING -> MANAGER_APPROVED -> HR_APPROVED
 *      \\              \\
 *       +--------------+--> REJECTED
 *
 * The central guarantee: a correction changes the official INTERPRETATION of a
 * day. It never touches AttendancePunchEvidence, WorkSession or BreakLog. The
 * raw record of what the device actually reported stays exactly as captured,
 * and the approved correction sits beside it, which is what makes a corrected
 * day auditable instead of merely different.
 */

const REQUEST_TYPES = [
  'MISSING_PUNCH',
  'LOCATION_EXCEPTION',
  'FACE_EXCEPTION',
  'LATE_CORRECTION',
  'HALF_DAY_CORRECTION',
] as const;

export interface CreateRegularizationInput {
  businessDate: string;
  requestType: (typeof REQUEST_TYPES)[number];
  reason: string;
  requestedPunchIn?: string | null;
  requestedPunchOut?: string | null;
}

export class RegularizationDisabledError extends Error {
  constructor() {
    super('Attendance corrections are not enabled.');
    this.name = 'RegularizationDisabledError';
  }
}

/** Raised when the day moved on after the request was raised. */
export class StaleCorrectionError extends Error {
  constructor() {
    super(
      'The attendance record for this date has changed since this correction was requested. ' +
        'It must be reviewed again against the current result.',
    );
    this.name = 'StaleCorrectionError';
  }
}

@Injectable()
export class RegularizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly eventLogger: EventLoggerService,
    private readonly hierarchy: HierarchyApprovalService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly settings: SettingsService,
    private readonly evaluator: DailyAttendanceEvaluatorService,
  ) {}

  /** Feature flag, defaulting OFF like every other Attendance V2 capability. */
  private async enabled(): Promise<boolean> {
    const cfg = await this.settings.get(ATTENDANCE_V2_SETTING_KEY);
    return (
      (cfg?.regularizationEnabled ?? ATTENDANCE_V2_DEFAULTS.regularizationEnabled) === true
    );
  }

  private assertDate(businessDate: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate ?? '')) {
      throw new BadRequestException('businessDate must be a yyyy-MM-dd date');
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Employee
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Raises a correction request for the AUTHENTICATED employee's own day.
   *
   * The subject is always the caller: there is no userId in the input, so there
   * is no path by which one employee can file a correction against another's
   * attendance.
   */
  async create(userId: string, input: CreateRegularizationInput) {
    if (!(await this.enabled())) throw new RegularizationDisabledError();
    this.assertDate(input.businessDate);

    if (!REQUEST_TYPES.includes(input.requestType)) {
      throw new BadRequestException('Unknown correction type');
    }
    if (!input.reason || input.reason.trim().length < 5) {
      throw new BadRequestException('Please explain what needs correcting');
    }

    const date = this.tva.companyDateOnly(new Date(`${input.businessDate}T00:00:00.000Z`));

    // One open request per day. A second one would give two approvers two
    // different answers for the same date.
    const open = await this.prisma.attendanceRegularization.findFirst({
      where: { userId, date, status: { in: ['PENDING', 'MANAGER_APPROVED'] } },
    });
    if (open) {
      throw new ForbiddenException('A correction for this date is already under review');
    }

    // Capture what the official result looked like when the employee argued
    // against it. Compared again at final approval; see approveAsHr.
    const official = await this.prisma.dailyAttendance.findUnique({
      where: { userId_date: { userId, date } },
    });

    const created = await this.prisma.attendanceRegularization.create({
      data: {
        userId,
        date,
        requestType: input.requestType as any,
        reason: input.reason.trim(),
        requestedPunchIn: input.requestedPunchIn ? new Date(input.requestedPunchIn) : null,
        requestedPunchOut: input.requestedPunchOut ? new Date(input.requestedPunchOut) : null,
        basedOnFingerprint: official?.sourceFingerprint ?? null,
        status: 'PENDING',
      },
    });

    this.eventLogger.log({
      actorId: userId,
      entityType: 'AttendanceRegularization',
      entityId: created.id,
      action: OperationalAction.REGULARIZATION_REQUESTED,
      toState: 'PENDING',
      metadata: { businessDate: input.businessDate, requestType: input.requestType },
    }).catch(() => {});

    return created;
  }

  /** The authenticated employee's own correction requests. */
  async listMine(userId: string, limit = 50) {
    return this.prisma.attendanceRegularization.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  /** One request, readable by its owner or by someone authorised to review it. */
  async findOne(actor: any, id: string) {
    const row = await this.prisma.attendanceRegularization.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Correction request not found');

    if (row.userId === actor?.id) return row;
    if (this.accessPolicy.isHrOrAdmin(actor)) return row;
    if (await this.hierarchy.isApproverFor(actor?.id, row.userId)) return row;

    // Same response as a genuine miss: revealing that someone else's request
    // exists is itself a small leak.
    throw new NotFoundException('Correction request not found');
  }

  // ───────────────────────────────────────────────────────────────────────
  // Review queue
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Requests awaiting THIS actor's decision.
   *
   * Scoped, never global: a manager sees only their own reports' requests, and
   * HR sees the requests that have cleared manager review.
   */
  async pendingFor(actor: any, limit = 100) {
    const take = Math.min(Math.max(limit, 1), 200);

    if (this.accessPolicy.isHrOrAdmin(actor)) {
      return this.prisma.attendanceRegularization.findMany({
        where: { status: 'MANAGER_APPROVED' },
        orderBy: { managerDecisionAt: 'asc' },
        take,
        include: { user: { select: { id: true, name: true, email: true } } },
      });
    }

    const pending = await this.prisma.attendanceRegularization.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take,
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    // Filtered through the existing hierarchy, so "my queue" means the people
    // who actually report to me.
    const mine = [];
    for (const row of pending) {
      if (await this.hierarchy.isApproverFor(actor?.id, row.userId)) mine.push(row);
    }
    return mine;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Decisions
  // ───────────────────────────────────────────────────────────────────────

  /** Stage one: the employee's actual reporting authority. */
  async approveAsManager(actor: any, id: string) {
    if (!(await this.enabled())) throw new RegularizationDisabledError();

    const row = await this.prisma.attendanceRegularization.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Correction request not found');
    if (row.status !== 'PENDING') {
      throw new ForbiddenException('This request is not awaiting manager review');
    }

    // The hierarchy resolver excludes the employee from their own chain, so
    // self-approval is impossible rather than merely refused.
    const chain = await this.hierarchy.resolveApproverChainFor(row.userId);
    const entry = chain.find((c) => c.id === actor?.id);
    if (!entry) {
      throw new ForbiddenException(
        "Only this employee's reporting hierarchy can review their attendance correction",
      );
    }
    const viaAdminOverride = entry.tier === 'ADMIN';

    const updated = await this.prisma.attendanceRegularization.update({
      where: { id },
      data: {
        status: 'MANAGER_APPROVED',
        managerApproverId: actor.id,
        managerDecisionAt: this.tva.now(),
      },
    });

    this.eventLogger.log({
      actorId: actor.id,
      entityType: 'AttendanceRegularization',
      entityId: id,
      action: OperationalAction.REGULARIZATION_MANAGER_APPROVED,
      fromState: 'PENDING',
      toState: viaAdminOverride ? 'MANAGER_APPROVED (admin override)' : 'MANAGER_APPROVED',
    }).catch(() => {});

    // Deliberately nothing else: manager approval alone changes no official
    // attendance fact. Only HR's decision does.
    return updated;
  }

  /**
   * Stage two: HR gives final approval and the official record is revised.
   *
   * Serialized end to end. The ordering matters:
   *
   *   1. Lock the regularization, so two approvals of the same request cannot
   *      both proceed.
   *   2. Re-read and re-check the stage after the lock.
   *   3. Lock the official DailyAttendance row for that employee-date.
   *   4. Compare its fingerprint against the one captured when the request was
   *      raised. If the day has moved on, refuse rather than overwrite a newer
   *      official result with a decision argued against an older one.
   *   5. Re-evaluate through the ordinary evaluator, which now sees the
   *      approved correction, and write the revision.
   */
  async approveAsHr(actor: any, id: string) {
    if (!(await this.enabled())) throw new RegularizationDisabledError();
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR can give final approval for an attendance correction');
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "attendance_regularizations" WHERE id = ${id} FOR UPDATE`;

      const row = await tx.attendanceRegularization.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Correction request not found');
      if (row.status !== 'MANAGER_APPROVED') {
        throw new ForbiddenException(
          'This request has not completed reporting-manager review yet',
        );
      }

      // Serialize on the official record this correction is about to rewrite.
      await tx.$queryRaw`SELECT id FROM "daily_attendance" WHERE "userId" = ${row.userId} AND "date" = ${row.date}::date FOR UPDATE`;

      const current = await tx.dailyAttendance.findUnique({
        where: { userId_date: { userId: row.userId, date: row.date } },
      });

      // Staleness guard. A null captured fingerprint means there was no
      // official record to argue against yet, which is a legitimate starting
      // point and not a conflict.
      if (
        row.basedOnFingerprint &&
        current?.sourceFingerprint &&
        row.basedOnFingerprint !== current.sourceFingerprint
      ) {
        throw new StaleCorrectionError();
      }

      const businessDate = this.tva.companyBusinessDate(row.date);

      const approved = await tx.attendanceRegularization.update({
        where: { id },
        data: {
          status: 'HR_APPROVED',
          hrApproverId: actor.id,
          hrDecisionAt: this.tva.now(),
        },
      });

      // Re-evaluated inside the same transaction, so the approval and the
      // revised official fact commit together or not at all.
      const revision = await this.evaluator.reviseForApprovedCorrection(
        tx,
        row.userId,
        businessDate,
        id,
      );

      return { approved, revision, businessDate };
    });

    const { approved, revision, businessDate } = outcome;

    this.eventLogger.log({
      actorId: actor.id,
      entityType: 'AttendanceRegularization',
      entityId: id,
      action: OperationalAction.REGULARIZATION_HR_APPROVED,
      fromState: 'MANAGER_APPROVED',
      toState: 'HR_APPROVED',
    }).catch(() => {});

    // The official change is audited against the ATTENDANCE record, not just
    // the request, so a payroll dispute can be answered from either side.
    this.eventLogger.log({
      actorId: actor.id,
      entityType: 'DailyAttendance',
      entityId: revision.after.id,
      action: OperationalAction.ATTENDANCE_OFFICIAL_REVISED,
      fromState: revision.before?.status ?? 'NONE',
      toState: revision.after.status,
      metadata: { businessDate, regularizationId: id, revision: revision.after.revision },
      beforeValue: this.auditSnapshot(revision.before),
      afterValue: this.auditSnapshot(revision.after),
    }).catch(() => {});

    return approved;
  }

  /**
   * Rejection at either stage. Leaves every official attendance fact alone.
   *
   * A reason is REQUIRED. A refusal an employee cannot understand is one they
   * will simply resubmit, and the audit row would record that a correction was
   * refused without recording why -- which is the part a later dispute needs.
   */
  async reject(actor: any, id: string, reason?: string) {
    if (!(await this.enabled())) throw new RegularizationDisabledError();

    const trimmed = (reason ?? '').trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('A reason is required when rejecting a correction request');
    }

    const row = await this.prisma.attendanceRegularization.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Correction request not found');
    if (row.status === 'HR_APPROVED' || row.status === 'REJECTED') {
      throw new ForbiddenException('This request has already been decided');
    }

    const isHr = this.accessPolicy.isHrOrAdmin(actor);
    if (!isHr && !(await this.hierarchy.isApproverFor(actor?.id, row.userId))) {
      throw new ForbiddenException(
        "Only this employee's reporting hierarchy or HR can reject their correction",
      );
    }

    const updated = await this.prisma.attendanceRegularization.update({
      where: { id },
      data: {
        status: 'REJECTED',
        ...(isHr
          ? { hrApproverId: actor.id, hrDecisionAt: this.tva.now() }
          : { managerApproverId: actor.id, managerDecisionAt: this.tva.now() }),
      },
    });

    this.eventLogger.log({
      actorId: actor.id,
      entityType: 'AttendanceRegularization',
      entityId: id,
      action: OperationalAction.REGULARIZATION_REJECTED,
      fromState: row.status,
      toState: 'REJECTED',
      metadata: { reason: trimmed },
    }).catch(() => {});

    return updated;
  }

  /**
   * What an audit entry keeps about an official record.
   *
   * Deliberately narrow: no photo bytes, no signed URL, no raw GPS payload.
   * Those live on the immutable evidence and must not be duplicated into an
   * event stream that is read far more widely.
   */
  private auditSnapshot(record: any) {
    if (!record) return null;
    return {
      status: record.status,
      evaluationState: record.evaluationState,
      punchInAt: record.punchInAt,
      punchOutAt: record.punchOutAt,
      workedMinutes: record.workedMinutes,
      breakMinutes: record.breakMinutes,
      lateMinutes: record.lateMinutes,
      calculationReason: record.calculationReason,
      exceptionFlags: record.exceptionFlags,
      revision: record.revision,
    };
  }
}
