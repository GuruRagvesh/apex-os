import { validateScreenshots, SCREENSHOT_METADATA, type ScreenshotUpload } from './correction-screenshot';
import { formatInTimeZone } from 'date-fns-tz';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CorrectionAuthorityService } from './correction-authority.service';
import { CorrectionDecisionService, UNRESOLVED_STATUSES } from './correction-decision.service';
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
import {
  MIN_REASON_EMPLOYEE_REQUEST,
  MIN_REASON_ENTERED_CORRECTION,
  buildCorrectionRecord,
  validateCorrectionProposal,
  type CorrectionProposal,
} from './correction-proposal';

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
  // Review-only: status / worked-hours / other concerns. Approval records the
  // decision and never revises the official day (see approveAsHr).
  'OTHER',
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

/** Why evidence-backed punching was impossible. Mirrors the Prisma enum. */
export const MANUAL_RECOVERY_REASONS = [
  'SERVER_UNAVAILABLE',
  'EMPLOYEE_INTERNET_ISSUE',
  'DEVICE_NETWORK_ISSUE',
  'CAMERA_OR_LOCATION_UNAVAILABLE',
  'PUNCH_SUBMISSION_FAILED',
  'OTHER',
] as const;

export type ManualRecoveryReasonInput = (typeof MANUAL_RECOVERY_REASONS)[number];

export interface ManualRecoveryInput {
  /** The employee whose punch is being recorded. Never the actor. */
  userId: string;
  businessDate: string;
  requestedPunchIn?: string | Date | null;
  requestedPunchOut?: string | Date | null;
  recoveryReason: ManualRecoveryReasonInput;
  reason: string;
  employeeInformedAt: string | Date;
  /** Set only when deliberately correcting a punch that already exists. */
  correctExisting?: boolean;
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
    @Optional() private readonly authority?: CorrectionAuthorityService,
    @Optional() private readonly decisions?: CorrectionDecisionService,
  ) {}

  /** Phase 3: once the single-decision workflow is on, the stage routes refuse. */
  private async assertLegacyStageRoutesAllowed() {
    if (this.decisions && (await this.decisions.enabled())) {
      throw new ConflictException({
        code: 'USE_DECISION_ENDPOINT',
        message: 'Attendance corrections are now decided once, by any eligible reviewer. Use the Approve or Reject decision.',
      });
    }
  }

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
  async create(userId: string, input: CreateRegularizationInput, files: ScreenshotUpload[] = []) {
    const screenshots = validateScreenshots(files);
    if (!(await this.enabled())) throw new RegularizationDisabledError();
    this.assertDate(input.businessDate);
    // A day that has not happened has nothing to correct.
    if (input.businessDate > this.tva.companyToday()) {
      throw new BadRequestException('Attendance for a future date cannot be corrected');
    }

    if (!REQUEST_TYPES.includes(input.requestType)) {
      throw new BadRequestException('Unknown correction type');
    }
    if (!input.reason || input.reason.trim().length < MIN_REASON_EMPLOYEE_REQUEST) {
      throw new BadRequestException('Please explain what needs correcting');
    }

    const date = this.tva.companyDateOnly(new Date(`${input.businessDate}T00:00:00.000Z`));

    // One open request per day. A second one would give two approvers two
    // different answers for the same date.
    const open = await this.prisma.attendanceRegularization.findFirst({
      where: { userId, date, status: { in: [...UNRESOLVED_STATUSES] } },
    });
    if (open) {
      throw new ForbiddenException('A correction for this date is already under review');
    }

    // Capture what the official result looked like when the employee argued
    // against it. Compared again at final approval; see approveAsHr.
    const official = await this.prisma.dailyAttendance.findUnique({
      where: { userId_date: { userId, date } },
    });

    // A recovered historical day is a verified, locked fact from before the attendance policy existed. The
    // ordinary evaluator cannot re-judge those dates, so a punch correction could not be applied to it (and
    // must never be allowed to overwrite it). Such a day can still be raised for HR to review as OTHER.
    if (official?.calculationReason === 'HISTORICAL_RECOVERY_IMPORT' && input.requestType !== 'OTHER') {
      throw new BadRequestException(
        'This day is a recovered historical record. Choose "Other attendance issue" so HR can review it; a punch correction cannot be applied to it.',
      );
    }

    const created = await this.prisma.attendanceRegularization.create({
      data: {
        userId,
        date,
        requestType: input.requestType as any,
        reason: input.reason.trim(),
        requestedPunchIn: input.requestedPunchIn ? new Date(input.requestedPunchIn) : null,
        requestedPunchOut: input.requestedPunchOut ? new Date(input.requestedPunchOut) : null,
        basedOnFingerprint: official?.sourceFingerprint ?? null,
        // The stored values the employee is arguing against, kept on the request so
        // a later reviewer can read "18:04 -> 18:31" without the live record.
        originalPunchIn: official?.punchInAt ?? null,
        originalPunchOut: official?.punchOutAt ?? null,
        status: 'PENDING',
        ...(screenshots.length ? { screenshots: { create: screenshots } } : {}),
      },
      include: { screenshots: { select: SCREENSHOT_METADATA } },
    }).catch((error: any) => {
      // The database is the authority on "one unresolved request per day":
      // two simultaneous submissions cannot both pass the check above.
      if (error?.code === 'P2002') throw new ForbiddenException('A correction for this date is already under review');
      throw error;
    });
    // Eligible reviewers are told at once (Phase 3); preferences decide channels.
    this.decisions?.notifyCreated(created).catch(() => undefined);

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
    const rows = await this.prisma.attendanceRegularization.findMany({
      where: { userId },
      include: { screenshots: { select: SCREENSHOT_METADATA } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const actorIds = [...new Set(rows.flatMap((row) => [row.decidedById, row.hrApproverId, row.managerApproverId]).filter((id): id is string => !!id))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const byId = new Map(actors.map((actor) => [actor.id, actor]));
    return rows.map((row) => {
      const actorId = row.decidedById ?? row.hrApproverId ?? row.managerApproverId;
      return { ...row, decidedBy: actorId ? byId.get(actorId) ?? { id: actorId, name: 'Deleted account' } : null };
    });
  }

  /** One request, readable by its owner or by someone authorised to review it. */
  async findOne(actor: any, id: string) {
    const row = await this.prisma.attendanceRegularization.findUnique({ where: { id }, include: { screenshots: { select: SCREENSHOT_METADATA } } });
    if (!row) throw new NotFoundException('Correction request not found');

    if (row.userId === actor?.id) return row;
    if (this.authority) {
      // Phase 3: the same eligibility that decides also governs who may read.
      const loaded = await this.authority.loadActor(actor?.id);
      if (await this.authority.eligibility(loaded, row.userId)) return row;
    } else {
      if (this.accessPolicy.isHrOrAdmin(actor)) return row;
      if (await this.hierarchy.isApproverFor(actor?.id, row.userId)) return row;
    }

    // Same response as a genuine miss: revealing that someone else's request
    // exists is itself a small leak.
    throw new NotFoundException('Correction request not found');
  }

  async screenshot(actor: any, requestId: string, screenshotId: string) {
    // Authorize the parent first; a guessed asset id cannot reveal another employee's file.
    await this.findOne(actor, requestId);
    const file = await this.prisma.correctionScreenshot.findFirst({ where: { id: screenshotId, regularizationId: requestId } });
    if (!file) throw new NotFoundException('Screenshot not found');
    return file;
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
  async pendingFor(actor: any, limit = 100, scope?: string, page?: number) {
    // Phase 3: scoped queues filtered in PostgreSQL before paging. The old
    // shape (HR saw only MANAGER_APPROVED; others filtered a global page in
    // memory) hid new requests and is no longer reachable when the scoped
    // service is present.
    if (this.decisions) {
      const resolved = scope === 'company' ? 'company' : 'team';
      return this.decisions.queue(actor?.id ?? actor?.sub, resolved, page, limit);
    }
    const take = Math.min(Math.max(limit, 1), 200);

    if (this.accessPolicy.isHrOrAdmin(actor)) {
      return this.prisma.attendanceRegularization.findMany({
        where: { status: 'MANAGER_APPROVED' },
        orderBy: { managerDecisionAt: 'asc' },
        take,
        include: { user: { select: { id: true, name: true, email: true } }, screenshots: { select: SCREENSHOT_METADATA } },
      });
    }

    const pending = await this.prisma.attendanceRegularization.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take,
      include: { user: { select: { id: true, name: true, email: true } }, screenshots: { select: SCREENSHOT_METADATA } },
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

  /** Wall-clock time in company time, for a message an employee will read. */
  private companyClock(at: Date): string {
    return formatInTimeZone(at, this.tva.companyTimezone(), 'HH:mm');
  }

  /**
   * Records a punch the employee could not record themselves.
   *
   * The last resort in a three-step hierarchy. The laptop is tried first, then
   * the employee's phone by QR, and only when neither can produce evidence does
   * an authorised person enter the punch on their behalf. It must never become
   * the ordinary route, which is why the employee cannot reach it at all.
   *
   * WHAT IS NOT FABRICATED. A manual entry carries no coordinates, no accuracy,
   * no geofence verdict and no photograph. Manufacturing any of those would
   * make an unevidenced punch indistinguishable from a verified one, which is
   * the one thing that would make the whole evidence chain worthless.
   *
   * LIFECYCLE. The creator's act of entering IS their operational judgment, so
   * the row starts at MANAGER_APPROVED rather than making the same person
   * immediately approve their own entry. HR approval is still required and is
   * still the only thing that rewrites official attendance -- a manager cannot
   * finalise, and nothing here changes a DailyAttendance row.
   *
   * For an HR or admin creator the operational stage is satisfied by their own
   * authority, and V1 permits the same person to give final approval. That is
   * a deliberate trade: requiring a second HR person sounds stronger, but an
   * outage recovery nobody is available to complete leaves the employee with no
   * attendance at all. The compensating controls are a mandatory reason, the
   * before/after snapshots, the creator identity, the role snapshot, a separate
   * explicit confirmation, row locking and a visible audit trail.
   */
  async createManualRecovery(actor: any, input: ManualRecoveryInput) {
    if (!(await this.enabled())) throw new RegularizationDisabledError();
    this.assertDate(input.businessDate);

    const actorId = actor?.id ?? actor?.sub;
    if (!actorId) throw new ForbiddenException('Not authenticated');

    // An employee may never enter their own authoritative punch. They request a
    // correction; somebody else records a recovery.
    if (actorId === input.userId) {
      throw new ForbiddenException(
        'You cannot record your own manual punch. Ask your manager or HR to record it.',
      );
    }

    const isHr = this.accessPolicy.isHrOrAdmin(actor);
    const inScope = await this.hierarchy.isApproverFor(actorId, input.userId);
    if (!isHr && !inScope) {
      throw new ForbiddenException(
        'You can only record a manual punch for an employee you manage',
      );
    }

    // Validation is stricter than the columns. They are nullable so existing
    // employee requests stay valid; a recovery without them is unjustifiable.
    if (!MANUAL_RECOVERY_REASONS.includes(input.recoveryReason as any)) {
      throw new BadRequestException('Select why the punch could not be recorded');
    }
    if (!input.employeeInformedAt) {
      throw new BadRequestException('Record when the employee reported the problem');
    }

    const date = this.tva.companyDateOnly(new Date(`${input.businessDate}T00:00:00.000Z`));

    const open = await this.prisma.attendanceRegularization.findFirst({
      where: { userId: input.userId, date, status: { in: [...UNRESOLVED_STATUSES] } },
    });
    if (open) {
      throw new ForbiddenException(
        'A correction for this date is already under review. Resolve it before recording another.',
      );
    }

    const official = await this.prisma.dailyAttendance.findUnique({
      where: { userId_date: { userId: input.userId, date } },
    });

    // Duplicate protection. Adding a second punch of a type that already exists
    // would leave two authoritative answers for one moment; the actor is routed
    // to a correction instead, which is what the original snapshots below
    // record.
    const proposal: CorrectionProposal = {
      punchInAt: input.requestedPunchIn ? new Date(input.requestedPunchIn) : null,
      punchOutAt: input.requestedPunchOut ? new Date(input.requestedPunchOut) : null,
      proposedStatus: null,
      reason: input.reason ?? '',
    };

    // The SAME rules a bulk-imported row is held to. Extracted rather than
    // duplicated: a spreadsheet row and a hand-entered day are one operation
    // with different paperwork, and two implementations of "is this punch pair
    // believable" would agree today and drift by the second change.
    //
    // The single-day caller wants the first problem as an exception; the
    // importer wants the whole list on the row. Same function, different
    // handling of what it returns.
    const problems = validateCorrectionProposal(proposal, official, {
      minReasonLength: MIN_REASON_ENTERED_CORRECTION,
      correctExisting: input.correctExisting,
      formatTime: (at) => this.companyClock(at),
    });
    if (problems.length > 0) {
      const [first] = problems;
      // A duplicate punch is a refusal of authority to add a second answer;
      // everything else is a malformed request.
      throw first.code === 'PUNCH_IN_ALREADY_EXISTS' || first.code === 'PUNCH_OUT_ALREADY_EXISTS'
        ? new ForbiddenException(first.message)
        : new BadRequestException(first.message);
    }

    const actorRole = this.accessPolicy.roleName(actor);

    const created = await this.prisma.attendanceRegularization.create({
      data: {
        ...(buildCorrectionRecord({
          userId: input.userId,
          date,
          proposal,
          official,
          entrySource: 'MANUAL_RECOVERY',
          requestType: 'MISSING_PUNCH',
          createdById: actorId,
          actorRoleAtEntry: actorRole,
          recoveryReason: input.recoveryReason ?? null,
          employeeInformedAt: new Date(input.employeeInformedAt),
        }) as any),

        // Phase 3: creating a recovery never approves it. It is an unresolved
        // request like any other; the creation and the later decision are
        // separate audit events (an HR/Admin creator must confirm separately).
        status: 'PENDING',
      },
    }).catch((error: any) => {
      if (error?.code === 'P2002') throw new ForbiddenException('A correction for this date is already under review. Resolve it before recording another.');
      throw error;
    });

    this.eventLogger.log({
      actorId,
      entityType: 'AttendanceRegularization',
      entityId: created.id,
      action: OperationalAction.REGULARIZATION_REQUESTED,
      toState: 'MANUAL_RECOVERY_ENTERED',
      metadata: {
        businessDate: input.businessDate,
        entrySource: 'MANUAL_RECOVERY',
        recoveryReason: input.recoveryReason,
        reason: input.reason.trim(),
        actorRole,
      },
      beforeValue: {
        punchInAt: official?.punchInAt ?? null,
        punchOutAt: official?.punchOutAt ?? null,
      },
      afterValue: {
        punchInAt: created.requestedPunchIn,
        punchOutAt: created.requestedPunchOut,
      },
    }).catch(() => {});

    return created;
  }

  /** Stage one: the employee's actual reporting authority. */
  async approveAsManager(actor: any, id: string) {
    if (!(await this.enabled())) throw new RegularizationDisabledError();
    await this.assertLegacyStageRoutesAllowed();

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
    await this.assertLegacyStageRoutesAllowed();
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
      // A review-only request (OTHER) rewrites nothing, so there is no newer
      // official result it could overwrite.
      if (
        row.requestType !== 'OTHER' &&
        row.basedOnFingerprint &&
        current?.sourceFingerprint &&
        row.basedOnFingerprint !== current.sourceFingerprint
      ) {
        throw new StaleCorrectionError();
      }

      const businessDate = this.tva.companyBusinessDate(row.date);

      // Never let a punch correction rewrite a recovered historical day (see create()).
      if (row.requestType !== 'OTHER' && current?.calculationReason === 'HISTORICAL_RECOVERY_IMPORT') {
        throw new ForbiddenException(
          'This day is a recovered historical record; a punch correction cannot be applied to it. Reject this request and raise it as Other for review.',
        );
      }

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
      // OTHER is review-only: HR's approval is recorded, the official day is not
      // touched. Whatever it concerns is then fixed through the ordinary,
      // audited routes (a punch correction or a manual recovery).
      const revision =
        row.requestType === 'OTHER'
          ? null
          : await this.evaluator.reviseForApprovedCorrection(tx, row.userId, businessDate, id);

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
    if (revision) {
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
    }

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
    await this.assertLegacyStageRoutesAllowed();

    const trimmed = (reason ?? '').trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('A reason is required when rejecting a correction request');
    }

    // Once the additive Phase 3 code is deployed, even the compatibility
    // route writes through the generic v1 decision writer. This preserves the
    // old URL while preventing a newly-created legacy REJECTED row.
    if (this.decisions) {
      return this.decisions.decideCompatibility(actor.id, id, {
        decision: 'REJECT',
        reason: trimmed,
      });
    }

    const row = await this.prisma.attendanceRegularization.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Correction request not found');
    if (row.status === 'HR_APPROVED' || row.status === 'REJECTED' || row.status === 'APPROVED') {
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
