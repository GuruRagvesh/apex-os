import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { DailyAttendanceStatus } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { DailyContextService } from '../context/daily-context.service';
import { LeaveFactsService } from './leave-facts.service';
import type { DailyAttendanceContext } from '../context/daily-context.types';
import {
  EVALUATOR_VERSION,
  type AttendanceCalculationReason,
  type AttendanceExceptionFlag,
  type DailyAttendanceResult,
  type EvaluationProvenance,
  type EvaluationState,
  type LeaveDayFacts,
} from './daily-attendance.types';

/**
 * The Daily Attendance Evaluator (AE-1).
 *
 * Turns resolved context + approved leave + immutable punch evidence + the
 * workday's own totals into the single official answer for one employee on one
 * business date.
 *
 * Three rules govern everything below:
 *
 *  1. It never recalculates workday internals. `totalWorkMinutes` and
 *     `totalBreakMinutes` are read from the finalized WorkSession, because the
 *     workday engine already owns that arithmetic (meeting-as-work included)
 *     and a second implementation would eventually disagree with the first.
 *
 *  2. It never manufactures a payroll-affecting outcome. Where management has
 *     not decided, the day becomes NEEDS_REVIEW — not ABSENT, not LWP, not a
 *     half day, and never a leave deduction.
 *
 *  3. It never mutates evidence. Punch rows and work sessions are read-only
 *     here; the only thing written is the DailyAttendance result itself.
 */
@Injectable()
export class DailyAttendanceEvaluatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly dailyContext: DailyContextService,
    private readonly leaveFacts: LeaveFactsService,
  ) {}

  /**
   * Evaluates one employee-date WITHOUT writing anything.
   *
   * Separated from persistence so the same logic can answer "what would today
   * look like right now?" for a live UI, where writing a provisional row on
   * every page load would be wrong.
   */
  async evaluate(userId: string, businessDate: string): Promise<DailyAttendanceResult> {
    const at = new Date(`${businessDate}T00:00:00.000Z`);
    const context = await this.dailyContext.resolveDailyContext(userId, at);

    // ── Applicability gate ───────────────────────────────────────────────
    // A configuration gap must never become an attendance outcome. None of
    // these produce an official classification, and none are persisted.
    if (context.attendanceApplicability !== 'REQUIRED') {
      const reason: AttendanceCalculationReason =
        context.attendanceApplicability === 'EXEMPT'
          ? 'NOT_APPLICABLE_EXEMPT'
          : context.attendanceApplicability === 'NOT_EMPLOYED'
            ? 'NOT_APPLICABLE_NOT_EMPLOYED'
            : 'CONTEXT_BLOCKED';

      return this.unofficial(userId, businessDate, context, reason);
    }

    const flags: AttendanceExceptionFlag[] = [];
    const leave = await this.leaveFacts.resolveForDate(userId, businessDate);

    if (leave.kind === 'AMBIGUOUS') {
      // Two approved leaves covering one date is a data problem. The day is
      // still evaluated on its punch evidence so a full workday is not lost,
      // but a human has to settle which leave applies.
      flags.push('AMBIGUOUS_APPROVED_LEAVE');
    }

    // ── Non-working days ─────────────────────────────────────────────────
    const calendar = context.calendar;
    if (!calendar.expectedCompanyWorkingDay) {
      return this.nonWorkingDay(userId, businessDate, context, leave, flags);
    }

    // ── Working day with proven leave ────────────────────────────────────
    if (leave.hasApprovedLeave && leave.kind !== 'AMBIGUOUS') {
      return this.leaveDay(userId, businessDate, context, leave, flags);
    }

    // ── Working day: punch and workday facts ─────────────────────────────
    return this.workingDay(userId, businessDate, context, leave, flags);
  }

  /**
   * Evaluates and persists the official result.
   *
   * Idempotent by design: an unchanged re-evaluation neither duplicates nor
   * rewrites the row, and a finalized or locked day is never recalculated.
   */
  async evaluateAndPersist(userId: string, businessDate: string) {
    const result = await this.evaluate(userId, businessDate);

    // Non-applicable and blocked days produce no official record at all.
    if (!result.official || result.status === null) {
      return { result, persisted: false, reason: 'NOT_OFFICIAL' as const };
    }

    const date = this.tva.companyDateOnly(new Date(`${businessDate}T00:00:00.000Z`));
    const existing = await this.prisma.dailyAttendance.findUnique({
      where: { userId_date: { userId, date } },
    });

    if (existing) {
      // A finalized or locked day is settled. Later corrections belong to the
      // regularization workflow, which is audited; silently recomputing over a
      // locked result would erase a decision somebody already made.
      if (existing.locked || existing.evaluationState === 'FINALIZED') {
        return { result, persisted: false, reason: 'LOCKED' as const, record: existing };
      }
      // Same inputs, same answer: nothing to write.
      if (existing.sourceFingerprint === result.sourceFingerprint) {
        return { result, persisted: false, reason: 'UNCHANGED' as const, record: existing };
      }
    }

    const data = this.toRow(result);
    const record = await this.prisma.dailyAttendance.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...data },
      update: data,
    });

    return { result, persisted: true, reason: 'WRITTEN' as const, record };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Branches
  // ───────────────────────────────────────────────────────────────────────

  private nonWorkingDay(
    userId: string,
    businessDate: string,
    context: DailyAttendanceContext,
    leave: LeaveDayFacts,
    flags: AttendanceExceptionFlag[],
  ): DailyAttendanceResult {
    const cal = context.calendar;

    let status: DailyAttendanceStatus = 'HOLIDAY';
    let reason: AttendanceCalculationReason = 'HOLIDAY';

    if (cal.override?.type === 'COMPANY_CLOSURE') {
      status = 'HOLIDAY';
      reason = 'COMPANY_CLOSURE';
    } else if (cal.holiday.isHoliday) {
      status = 'HOLIDAY';
      reason = 'HOLIDAY';
    } else if (cal.weeklyOff.isWeeklyOff) {
      status = 'WEEKLY_OFF';
      reason = 'WEEKLY_OFF';
    }

    // Approved leave landing on a non-working day deducts NOTHING here. The
    // leave policy's own holidaysExcluded/weeklyOffExcluded settings are what
    // would authorise a deduction, and inventing one would quietly cost the
    // employee a day off. Flagged so it is visible rather than lost.
    if (leave.hasApprovedLeave) flags.push('LEAVE_ON_NON_WORKING_DAY');

    return this.build({
      userId,
      businessDate,
      context,
      status,
      reason,
      flags,
      leaveRequestId: leave.leaveRequestId,
      // Deliberately zero. See above.
      leaveDeducted: 0,
      lwpDeducted: 0,
    });
  }

  private leaveDay(
    userId: string,
    businessDate: string,
    context: DailyAttendanceContext,
    leave: LeaveDayFacts,
    flags: AttendanceExceptionFlag[],
  ): DailyAttendanceResult {
    let status: DailyAttendanceStatus;
    let reason: AttendanceCalculationReason;
    let leaveDeducted = 0;
    let lwpDeducted = 0;

    switch (leave.kind) {
      case 'PAID':
        status = 'LEAVE';
        reason = 'APPROVED_PAID_LEAVE';
        leaveDeducted = 1;
        break;
      case 'UNPAID':
        // LWP because the leave record itself says UNPAID, not because a
        // balance lookup came back empty.
        status = 'LWP';
        reason = 'APPROVED_UNPAID_LEAVE';
        lwpDeducted = 1;
        break;
      case 'HALF_DAY_PAID':
        // An explicitly approved half day is proven, not manufactured, so
        // automaticHalfDayEnabled does not gate it.
        status = 'HALF_DAY';
        reason = 'APPROVED_HALF_DAY_LEAVE';
        leaveDeducted = 0.5;
        break;
      case 'HALF_DAY_UNPAID':
        status = 'HALF_DAY';
        reason = 'APPROVED_HALF_DAY_LEAVE';
        lwpDeducted = 0.5;
        break;
      default:
        status = 'LEAVE';
        reason = 'APPROVED_PAID_LEAVE';
        leaveDeducted = 1;
    }

    return this.build({
      userId,
      businessDate,
      context,
      status,
      reason,
      flags,
      leaveRequestId: leave.leaveRequestId,
      leaveDeducted,
      lwpDeducted,
    });
  }

  private async workingDay(
    userId: string,
    businessDate: string,
    context: DailyAttendanceContext,
    leave: LeaveDayFacts,
    flags: AttendanceExceptionFlag[],
  ): Promise<DailyAttendanceResult> {
    const date = this.tva.companyDateOnly(new Date(`${businessDate}T00:00:00.000Z`));

    const [evidence, sessions] = await Promise.all([
      this.prisma.attendancePunchEvidence.findMany({
        where: { userId, businessDate: date },
        orderBy: { serverOccurredAt: 'asc' },
      }),
      this.prisma.workSession.findMany({
        where: { userId, date },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const punchIn = evidence.find((e) => e.type === 'PUNCH_IN') ?? null;
    const punchOut = [...evidence].reverse().find((e) => e.type === 'PUNCH_OUT') ?? null;
    const workSessionIds = sessions.map((s) => s.id);

    this.collectEvidenceExceptions(evidence, flags);

    // ── No evidence at all ───────────────────────────────────────────────
    // No punch, no session, no approved leave, on a day the company expected
    // work. That is a factual exception, and there is no policy field today
    // that authorises turning it into an automatic ABSENT.
    if (!punchIn && sessions.length === 0) {
      flags.push('NO_ATTENDANCE_EVIDENCE');
      return this.build({
        userId,
        businessDate,
        context,
        status: 'MISSING_PUNCH',
        reason: 'NO_EVIDENCE_ON_WORKING_DAY',
        flags,
        forceReview: true,
        leaveRequestId: leave.leaveRequestId,
      });
    }

    const openSession = sessions.find((s) => !s.logoutAt);
    const closed = sessions.filter((s) => !!s.logoutAt);

    // Workday totals come from the workday engine, never recomputed here.
    const workedMinutes = closed.reduce((n, s) => n + (s.totalWorkMinutes ?? 0), 0);
    const breakMinutes = closed.reduce((n, s) => n + (s.totalBreakMinutes ?? 0), 0);

    const punchInAt = punchIn?.serverOccurredAt ?? sessions[0]?.startWorkAt ?? null;
    const punchOutAt = punchOut?.serverOccurredAt ?? null;
    const lateMinutes = this.lateMinutes(context, punchInAt);

    // ── Still working ────────────────────────────────────────────────────
    // Provisional only: useful for today's UI, explicitly not finalized.
    if (openSession) {
      flags.push('WORKDAY_STILL_OPEN');
      return this.build({
        userId,
        businessDate,
        context,
        status: 'PRESENT',
        reason: 'WORKDAY_IN_PROGRESS',
        flags,
        punchInAt,
        punchOutAt: null,
        workedMinutes,
        breakMinutes,
        lateMinutes,
        punchInEvidenceId: punchIn?.id ?? null,
        punchOutEvidenceId: null,
        workSessionIds,
        leaveRequestId: leave.leaveRequestId,
      });
    }

    // ── Incomplete punch pair ────────────────────────────────────────────
    // The session closed (possibly by the auto-close scheduler) but the
    // employee never punched out. No end time is fabricated.
    if (punchIn && !punchOut) {
      flags.push('MISSING_PUNCH_OUT');
      return this.build({
        userId,
        businessDate,
        context,
        status: 'MISSING_PUNCH',
        reason: 'INCOMPLETE_PUNCH_PAIR',
        flags,
        forceReview: true,
        punchInAt,
        punchOutAt: null,
        workedMinutes,
        breakMinutes,
        lateMinutes,
        punchInEvidenceId: punchIn.id,
        workSessionIds,
        leaveRequestId: leave.leaveRequestId,
      });
    }

    // A closed session with no punch evidence at all: the workday happened
    // through the legacy controls, which is normal while the punch feature is
    // off. Not an exception, but there is no punch pair to judge.
    if (!punchIn) {
      flags.push('MISSING_PUNCH');
    }

    // ── Complete working day, subject to policy questions ────────────────
    let status: DailyAttendanceStatus = 'PRESENT';
    let reason: AttendanceCalculationReason = 'COMPLETE_WORKDAY';
    let forceReview = false;
    let leaveDeducted = 0;
    let lwpDeducted = 0;

    const policy = context.attendancePolicy;
    const required = context.shift?.minimumWorkingMinutes ?? policy?.minimumWorkingMinutes ?? 540;

    // Late beyond the punch window.
    if (lateMinutes > 0) {
      status = policy?.lateExemptionEnabled ? 'LATE_EXEMPTED' : 'LATE';
      const decision = this.applyPolicyAction(
        policy?.afterPunchWindowAction,
        policy?.automaticHalfDayEnabled === true,
      );
      flags.push('LATE_BEYOND_PUNCH_WINDOW');
      if (decision.review) forceReview = true;
      if (decision.status) status = decision.status;
      leaveDeducted += decision.leaveDeducted;
      lwpDeducted += decision.lwpDeducted;
      if (decision.status || decision.review) reason = 'POLICY_DECISION_DEFERRED';
    }

    // Short day.
    if (workedMinutes < required) {
      flags.push('INSUFFICIENT_HOURS');
      const decision = this.applyPolicyAction(
        policy?.insufficientHoursAction,
        policy?.automaticHalfDayEnabled === true,
      );
      if (decision.review) forceReview = true;
      if (decision.status) status = decision.status;
      leaveDeducted += decision.leaveDeducted;
      lwpDeducted += decision.lwpDeducted;
      if (decision.status || decision.review) reason = 'POLICY_DECISION_DEFERRED';
    }

    if (context.calendar.override?.type === 'SPECIAL_WORKING_DAY' && reason === 'COMPLETE_WORKDAY') {
      reason = 'SPECIAL_WORKING_DAY_WORKED';
    }

    return this.build({
      userId,
      businessDate,
      context,
      status,
      reason,
      flags,
      forceReview,
      punchInAt,
      punchOutAt,
      workedMinutes,
      breakMinutes,
      lateMinutes,
      leaveDeducted,
      lwpDeducted,
      punchInEvidenceId: punchIn?.id ?? null,
      punchOutEvidenceId: punchOut?.id ?? null,
      workSessionIds,
      leaveRequestId: leave.leaveRequestId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Translates a configured PolicyDecisionAction into an outcome.
   *
   * REQUIRE_REVIEW is the default on both fields, so an undecided rule can only
   * ever produce a review. The two DEDUCT_* actions are recognised but NOT
   * executed: applying them means writing to leave balances, which is payroll
   * territory and out of scope for this wave — they route to review instead of
   * silently doing half the job.
   */
  private applyPolicyAction(
    action: string | undefined,
    automaticHalfDayEnabled: boolean,
  ): {
    review: boolean;
    status: DailyAttendanceStatus | null;
    leaveDeducted: number;
    lwpDeducted: number;
  } {
    const none = { review: false, status: null, leaveDeducted: 0, lwpDeducted: 0 };

    switch (action) {
      case 'NO_ACTION':
        return none;
      case 'MARK_HALF_DAY':
        // Explicitly gated: with automatic half-day off, a threshold must never
        // manufacture one, whatever the action says.
        return automaticHalfDayEnabled
          ? { ...none, status: 'HALF_DAY' }
          : { ...none, review: true };
      case 'MARK_ABSENT':
        return { ...none, status: 'ABSENT' };
      case 'MARK_LWP':
        return { ...none, status: 'LWP', lwpDeducted: 1 };
      case 'DEDUCT_HALF_PAID_LEAVE':
      case 'DEDUCT_FULL_PAID_LEAVE':
        return { ...none, review: true };
      case 'REQUIRE_REVIEW':
      default:
        return { ...none, review: true };
    }
  }

  /** Location and photo observations. NOT_ENFORCED is a policy fact, not a fault. */
  private collectEvidenceExceptions(evidence: any[], flags: AttendanceExceptionFlag[]) {
    for (const e of evidence) {
      switch (e.locationVerification) {
        case 'OUTSIDE_GEOFENCE':
          if (!flags.includes('LOCATION_OUTSIDE_GEOFENCE')) flags.push('LOCATION_OUTSIDE_GEOFENCE');
          break;
        case 'LOW_ACCURACY':
          if (!flags.includes('LOCATION_LOW_ACCURACY')) flags.push('LOCATION_LOW_ACCURACY');
          break;
        case 'UNAVAILABLE':
          if (!flags.includes('LOCATION_UNAVAILABLE')) flags.push('LOCATION_UNAVAILABLE');
          break;
        default:
          break; // VERIFIED and NOT_ENFORCED are both fine.
      }
      if (e.photoVerification && e.photoVerification !== 'CAPTURED') {
        if (!flags.includes('PHOTO_MISSING')) flags.push('PHOTO_MISSING');
      }
    }
  }

  /** Minutes past the shift start plus its grace window. Zero when on time. */
  private lateMinutes(context: DailyAttendanceContext, punchInAt: Date | null): number {
    const shift = context.shift;
    if (!shift || !punchInAt) return 0;

    // Shift start as a real instant in company time, via the time authority.
    const shiftStart = this.tva.companyInstantAt(context.businessDate, shift.startTime);
    if (!shiftStart) return 0;

    const allowedFrom = new Date(shiftStart.getTime() + (shift.graceMinutes ?? 0) * 60_000);

    const diff = Math.floor((punchInAt.getTime() - allowedFrom.getTime()) / 60_000);
    return diff > 0 ? diff : 0;
  }

  private provenanceOf(context: DailyAttendanceContext, extra: Partial<EvaluationProvenance>) {
    const s = context.sources;
    return {
      resolverVersion: context.resolverVersion,
      evaluatorVersion: EVALUATOR_VERSION,
      employeeProfileId: s.employeeProfileId,
      attendancePolicyId: s.attendancePolicyId,
      attendancePolicyVersion: s.attendancePolicyVersion,
      shiftPolicyId: s.shiftPolicyId,
      shiftPolicyVersion: s.shiftPolicyVersion,
      holidayCalendarId: s.resolvedHolidayCalendarId ?? s.holidayCalendarId,
      weeklyOffPolicyId: s.resolvedWeeklyOffPolicyId ?? s.weeklyOffPolicyId,
      holidayId: s.holidayId,
      businessDayOverrideId: s.businessDayOverrideId,
      leaveRequestId: null,
      punchInEvidenceId: null,
      punchOutEvidenceId: null,
      workSessionIds: [],
      ...extra,
    } as EvaluationProvenance;
  }

  private unofficial(
    userId: string,
    businessDate: string,
    context: DailyAttendanceContext,
    reason: AttendanceCalculationReason,
  ): DailyAttendanceResult {
    return {
      employeeId: userId,
      businessDate,
      official: false,
      status: null,
      // Blocked configuration is a review item for HR; exempt and not-employed
      // are simply not attendance situations.
      evaluationState: reason === 'CONTEXT_BLOCKED' ? 'NEEDS_REVIEW' : 'CALCULATED',
      calculationReason: reason,
      exceptionFlags: [],
      punchInAt: null,
      punchOutAt: null,
      workedMinutes: 0,
      breakMinutes: 0,
      lateMinutes: 0,
      leaveDeducted: 0,
      lwpDeducted: 0,
      requiresReview: reason === 'CONTEXT_BLOCKED',
      provenance: this.provenanceOf(context, {}),
      sourceFingerprint: '',
      evaluatedAt: this.tva.now(),
    };
  }

  private build(input: {
    userId: string;
    businessDate: string;
    context: DailyAttendanceContext;
    status: DailyAttendanceStatus;
    reason: AttendanceCalculationReason;
    flags: AttendanceExceptionFlag[];
    forceReview?: boolean;
    punchInAt?: Date | null;
    punchOutAt?: Date | null;
    workedMinutes?: number;
    breakMinutes?: number;
    lateMinutes?: number;
    leaveDeducted?: number;
    lwpDeducted?: number;
    punchInEvidenceId?: string | null;
    punchOutEvidenceId?: string | null;
    workSessionIds?: string[];
    leaveRequestId?: string | null;
  }): DailyAttendanceResult {
    // Any exception at all means a human should look. Review is the safe
    // direction: it delays a decision instead of inventing one.
    const requiresReview = input.forceReview === true || input.flags.length > 0;
    const evaluationState: EvaluationState = requiresReview ? 'NEEDS_REVIEW' : 'CALCULATED';

    const provenance = this.provenanceOf(input.context, {
      leaveRequestId: input.leaveRequestId ?? null,
      punchInEvidenceId: input.punchInEvidenceId ?? null,
      punchOutEvidenceId: input.punchOutEvidenceId ?? null,
      workSessionIds: input.workSessionIds ?? [],
    });

    const result: DailyAttendanceResult = {
      employeeId: input.userId,
      businessDate: input.businessDate,
      official: true,
      status: input.status,
      evaluationState,
      calculationReason: input.reason,
      exceptionFlags: input.flags,
      punchInAt: input.punchInAt ?? null,
      punchOutAt: input.punchOutAt ?? null,
      workedMinutes: input.workedMinutes ?? 0,
      breakMinutes: input.breakMinutes ?? 0,
      lateMinutes: input.lateMinutes ?? 0,
      leaveDeducted: input.leaveDeducted ?? 0,
      lwpDeducted: input.lwpDeducted ?? 0,
      requiresReview,
      provenance,
      sourceFingerprint: '',
      evaluatedAt: this.tva.now(),
    };

    result.sourceFingerprint = this.fingerprint(result);
    return result;
  }

  /**
   * Digest of everything that determined this result.
   *
   * `evaluatedAt` is deliberately excluded — it changes on every call, and a
   * fingerprint that always differs would defeat the idempotency check it
   * exists to serve.
   */
  private fingerprint(r: DailyAttendanceResult): string {
    const canonical = JSON.stringify({
      employeeId: r.employeeId,
      businessDate: r.businessDate,
      status: r.status,
      state: r.evaluationState,
      reason: r.calculationReason,
      flags: [...r.exceptionFlags].sort(),
      punchInAt: r.punchInAt?.toISOString() ?? null,
      punchOutAt: r.punchOutAt?.toISOString() ?? null,
      workedMinutes: r.workedMinutes,
      breakMinutes: r.breakMinutes,
      lateMinutes: r.lateMinutes,
      leaveDeducted: r.leaveDeducted,
      lwpDeducted: r.lwpDeducted,
      provenance: r.provenance,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  /** Result -> DailyAttendance columns. */
  private toRow(r: DailyAttendanceResult) {
    return {
      status: r.status as DailyAttendanceStatus,
      punchInAt: r.punchInAt,
      punchOutAt: r.punchOutAt,
      workedMinutes: r.workedMinutes,
      breakMinutes: r.breakMinutes,
      lateMinutes: r.lateMinutes,
      leaveDeducted: r.leaveDeducted,
      lwpDeducted: r.lwpDeducted,
      calculationReason: r.calculationReason,
      evaluationState: r.evaluationState,
      evaluatorVersion: r.provenance.evaluatorVersion,
      resolverVersion: r.provenance.resolverVersion,
      evaluatedAt: r.evaluatedAt,
      exceptionFlags: r.exceptionFlags,
      sourceFingerprint: r.sourceFingerprint,
      employeeProfileId: r.provenance.employeeProfileId,
      attendancePolicyId: r.provenance.attendancePolicyId,
      attendancePolicyVersion: r.provenance.attendancePolicyVersion,
      shiftPolicyId: r.provenance.shiftPolicyId,
      shiftPolicyVersion: r.provenance.shiftPolicyVersion,
      holidayCalendarId: r.provenance.holidayCalendarId,
      weeklyOffPolicyId: r.provenance.weeklyOffPolicyId,
      holidayId: r.provenance.holidayId,
      businessDayOverrideId: r.provenance.businessDayOverrideId,
      leaveRequestId: r.provenance.leaveRequestId,
      punchInEvidenceId: r.provenance.punchInEvidenceId,
      punchOutEvidenceId: r.provenance.punchOutEvidenceId,
      workSessionIds: r.provenance.workSessionIds,
      policyVersion:
        r.provenance.attendancePolicyVersion != null
          ? String(r.provenance.attendancePolicyVersion)
          : null,
    };
  }
}
